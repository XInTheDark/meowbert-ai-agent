import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type JsonRpcId = number | string;

export interface JsonRpcRequestMessage {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface AcpJsonRpcClientOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onRequest?: (request: JsonRpcRequestMessage) => Promise<unknown>;
  onNotification?: (notification: JsonRpcNotificationMessage) => void;
  onUnexpectedExit?: (error: Error) => void;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

const MAX_STDERR_CHARS = 8_192;
const GRACEFUL_CLOSE_TIMEOUT_MS = 5_000;
const SIGTERM_TIMEOUT_MS = 2_000;

export class AcpJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingCall>();
  private readonly onRequest?: AcpJsonRpcClientOptions["onRequest"];
  private readonly onNotification?: AcpJsonRpcClientOptions["onNotification"];
  private readonly onUnexpectedExit?: AcpJsonRpcClientOptions["onUnexpectedExit"];
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrTail = "";
  private closed = false;
  private closingGracefully = false;
  private readonly exitPromise: Promise<number | null>;

  constructor(options: AcpJsonRpcClientOptions) {
    this.onRequest = options.onRequest;
    this.onNotification = options.onNotification;
    this.onUnexpectedExit = options.onUnexpectedExit;
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.exitPromise = new Promise<number | null>((resolve) => {
      this.child.once("error", (error) => {
        this.handleProcessTerminated(new Error(`Antigravity ACP process error: ${error.message}`));
        resolve(null);
      });
      this.child.once("close", (code, signal) => {
        const detail = this.stderrTail.trim();
        const reason = `Antigravity ACP process exited (code=${code ?? "null"}, signal=${signal ?? "null"})${detail ? `: ${detail.slice(-400)}` : ""}`;
        this.handleProcessTerminated(new Error(reason));
        resolve(code);
      });
    });

    this.child.stdout.on("data", (chunk: Buffer) => this.handleStdoutChunk(chunk.toString("utf8")));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-MAX_STDERR_CHARS);
    });
  }

  isClosed(): boolean {
    return this.closed;
  }

  getStderrTail(): string {
    return this.stderrTail;
  }

  private handleStdoutChunk(text: string): void {
    this.stdoutBuffer += text;
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.dispatchLine(trimmed);
    }
  }

  private dispatchLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    const hasId = typeof msg.id === "number" || typeof msg.id === "string";
    const hasMethod = typeof msg.method === "string";

    if (hasId && !hasMethod) {
      this.handleResponse(msg.id as JsonRpcId, msg.result, msg.error);
      return;
    }
    if (hasId && hasMethod) {
      void this.handleIncomingRequest({
        jsonrpc: "2.0",
        id: msg.id as JsonRpcId,
        method: msg.method as string,
        params: msg.params
      });
      return;
    }
    if (hasMethod) {
      this.onNotification?.({
        jsonrpc: "2.0",
        method: msg.method as string,
        params: msg.params
      });
    }
  }

  private handleResponse(id: JsonRpcId, result: unknown, error: unknown): void {
    if (typeof id !== "number") return;
    const call = this.pending.get(id);
    if (!call) return;
    this.pending.delete(id);
    if (call.timer) clearTimeout(call.timer);
    if (error && typeof error === "object") {
      const record = error as { code?: unknown; message?: unknown };
      const message = typeof record.message === "string" ? record.message : JSON.stringify(error);
      const code = typeof record.code === "number" ? ` (code ${record.code})` : "";
      call.reject(new Error(`ACP error${code}: ${message}`));
      return;
    }
    call.resolve(result);
  }

  private async handleIncomingRequest(req: JsonRpcRequestMessage): Promise<void> {
    if (!this.onRequest) {
      this.writeMessage({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "Method not handled." } });
      return;
    }
    try {
      const result = await this.onRequest(req);
      this.writeMessage({ jsonrpc: "2.0", id: req.id, result });
    } catch (error) {
      this.writeMessage({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  private writeMessage(payload: Record<string, unknown>): void {
    if (this.closed || this.child.stdin.destroyed) return;
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleProcessTerminated(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, call] of this.pending) {
      if (call.timer) clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
    if (!this.closingGracefully) {
      this.onUnexpectedExit?.(error);
    }
  }

  request<T = Record<string, unknown>>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Antigravity ACP process is already closed."));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`ACP request "${method}" timed out after ${timeoutMs}ms.`));
          }, timeoutMs)
        : null;
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });
      this.writeMessage({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.writeMessage({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
  }

  async closeGracefully(sessionId?: string | null): Promise<void> {
    this.closingGracefully = true;
    if (!this.closed) {
      if (sessionId) {
        await this.request("session/close", { sessionId }, 3_000).catch(() => undefined);
      }
      try {
        this.child.stdin.end();
      } catch {
        // Ignore already-ended stdin.
      }
    }
    const exitedCleanly = await Promise.race([
      this.exitPromise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), GRACEFUL_CLOSE_TIMEOUT_MS))
    ]);
    if (exitedCleanly) return;

    try { this.child.kill("SIGTERM"); } catch { /* ignore */ }
    const exitedAfterTerm = await Promise.race([
      this.exitPromise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SIGTERM_TIMEOUT_MS))
    ]);
    if (!exitedAfterTerm) {
      try { this.child.kill("SIGKILL"); } catch { /* ignore */ }
      await this.exitPromise;
    }
  }

  kill(): void {
    this.closingGracefully = true;
    if (this.closed) return;
    try { this.child.kill("SIGKILL"); } catch { /* ignore */ }
  }
}
