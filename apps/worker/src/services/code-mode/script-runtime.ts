import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule
} from "quickjs-emscripten-core";

const SCRIPT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const SCRIPT_MAX_STACK_BYTES = 1024 * 1024;
const MAX_LOG_CHARS = 1_000_000;

export interface CodeModeScriptInput {
  code: string;
  toolNames: string[];
  // Runs one tool call and resolves to its JSON-serializable result. Calls never overlap.
  callTool: (name: string, args: unknown) => Promise<unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface CodeModeScriptResult {
  logs: string;
  result: unknown;
  error: string | null;
  timedOut: boolean;
  cancelled: boolean;
}

let quickJsModule: Promise<QuickJSWASMModule> | null = null;

function loadQuickJs(): Promise<QuickJSWASMModule> {
  quickJsModule ??= newQuickJSWASMModuleFromVariant(import("@jitl/quickjs-ng-wasmfile-release-sync"));
  return quickJsModule;
}

// The script sees `tools`, `console` and nothing else from the host. Values cross the boundary as
// JSON so no handle outlives a call, and the script body runs inside an async function so it can
// use top-level `await` and `return`.
function buildScriptSource(code: string, toolNames: string[]): string {
  return `
const __format = (value) => typeof value === "string" ? value : (() => {
  try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); }
})();
globalThis.console = Object.freeze(Object.fromEntries(["log", "info", "warn", "error", "debug"].map((level) => [
  level,
  (...args) => __hostLog(args.map(__format).join(" "))
])));
globalThis.tools = Object.freeze(Object.fromEntries(${JSON.stringify(toolNames)}.map((name) => [
  name,
  async (args = {}) => JSON.parse(await __hostCallTool(name, JSON.stringify(args ?? {})))
])));
(async () => {
${code}
})().then((value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value) ?? "null"));
`;
}

function describeError(context: QuickJSContext, handle: QuickJSHandle): string {
  const value = context.dump(handle) as unknown;
  if (value && typeof value === "object") {
    const record = value as { name?: unknown; message?: unknown; stack?: unknown };
    const head = `${typeof record.name === "string" ? record.name : "Error"}: ${String(record.message ?? "")}`;
    return typeof record.stack === "string" && record.stack.trim() ? `${head}\n${record.stack.trim()}` : head;
  }
  return String(value);
}

class ScriptHost {
  private readonly logParts: string[] = [];
  private logChars = 0;
  private droppedLogChars = 0;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private stopped = false;

  constructor(
    private readonly runtime: QuickJSRuntime,
    private readonly context: QuickJSContext,
    private readonly input: CodeModeScriptInput
  ) {}

  install(): void {
    this.context.newFunction("__hostLog", (lineHandle) => {
      this.appendLog(this.context.getString(lineHandle));
    }).consume((fn) => this.context.setProp(this.context.global, "__hostLog", fn));

    this.context.newFunction("__hostCallTool", (nameHandle, argsHandle) => {
      const name = this.context.getString(nameHandle);
      const argsJson = this.context.getString(argsHandle);
      const deferred = this.context.newPromise();
      this.enqueueCall(name, argsJson, (resultJson, errorMessage) => {
        if (this.disposed) return;
        const handle = errorMessage === null ? this.context.newString(resultJson) : this.context.newError(errorMessage);
        if (errorMessage === null) deferred.resolve(handle);
        else deferred.reject(handle);
        handle.dispose();
        this.runtime.executePendingJobs();
      });
      return deferred.handle;
    }).consume((fn) => this.context.setProp(this.context.global, "__hostCallTool", fn));
  }

  // Stops new tool calls and waits for the one in flight, so nothing runs after the script ends.
  async stop(): Promise<void> {
    this.stopped = true;
    await this.queue;
  }

  markDisposed(): void {
    this.disposed = true;
  }

  get logs(): string {
    const text = this.logParts.join("\n");
    return this.droppedLogChars > 0 ? `${text}\n… ${this.droppedLogChars} more log characters dropped` : text;
  }

  private appendLog(line: string): void {
    if (this.logChars >= MAX_LOG_CHARS) {
      this.droppedLogChars += line.length;
      return;
    }
    this.logParts.push(line);
    this.logChars += line.length + 1;
  }

  private enqueueCall(name: string, argsJson: string, settle: (resultJson: string, error: string | null) => void): void {
    this.queue = this.queue.then(async () => {
      if (this.stopped) {
        settle("", "exec stopped before this tool call could run.");
        return;
      }
      try {
        const result = await this.input.callTool(name, JSON.parse(argsJson) as unknown);
        settle(JSON.stringify(result ?? null), null);
      } catch (error) {
        settle("", error instanceof Error ? error.message : String(error));
      }
    });
  }
}

function waitForStop(timeoutMs: number, signal: AbortSignal | undefined): { promise: Promise<"timeout" | "cancelled">; clear: () => void } {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const promise = new Promise<"timeout" | "cancelled">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    if (signal?.aborted) {
      resolve("cancelled");
      return;
    }
    onAbort = () => resolve("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  return {
    promise,
    clear: () => {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  };
}

async function settleScript(
  runtime: QuickJSRuntime,
  context: QuickJSContext,
  promiseHandle: QuickJSHandle,
  stop: Promise<"timeout" | "cancelled">
): Promise<{ result: unknown; error: string | null } | "timeout" | "cancelled"> {
  const resolved = context.resolvePromise(promiseHandle);
  // resolvePromise subscribes inside the VM; run that job now in case the script already settled.
  runtime.executePendingJobs();
  const settled = resolved.then((outcome) => {
    if (outcome.error) {
      const error = describeError(context, outcome.error);
      outcome.error.dispose();
      return { result: undefined, error };
    }
    const result = context.dump(outcome.value) as unknown;
    outcome.value.dispose();
    return { result, error: null };
  });
  return Promise.race([settled, stop]);
}

export async function runCodeModeScript(input: CodeModeScriptInput): Promise<CodeModeScriptResult> {
  const quickJs = await loadQuickJs();
  const runtime = quickJs.newRuntime();
  const deadline = Date.now() + input.timeoutMs;
  runtime.setMemoryLimit(SCRIPT_MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(SCRIPT_MAX_STACK_BYTES);
  runtime.setInterruptHandler(() => Date.now() > deadline || input.signal?.aborted === true);

  const context = runtime.newContext();
  const host = new ScriptHost(runtime, context, input);
  const stop = waitForStop(input.timeoutMs, input.signal);
  let outcome: { result: unknown; error: string | null } | "timeout" | "cancelled";
  try {
    host.install();
    const evaluation = context.evalCode(buildScriptSource(input.code, input.toolNames), "exec.js");
    if (evaluation.error) {
      outcome = { result: undefined, error: describeError(context, evaluation.error) };
      evaluation.error.dispose();
    } else {
      outcome = await evaluation.value.consume((promiseHandle) => settleScript(runtime, context, promiseHandle, stop.promise));
    }
  } finally {
    stop.clear();
    await host.stop();
    host.markDisposed();
  }

  const logs = host.logs;
  const timedOut = outcome === "timeout" || (typeof outcome === "object" && outcome.error?.includes("interrupted") === true && Date.now() > deadline);
  const cancelled = outcome === "cancelled" || input.signal?.aborted === true;
  disposeQuietly(context, runtime);
  if (typeof outcome === "object" && !timedOut && !cancelled) {
    return { logs, result: outcome.result, error: outcome.error, timedOut: false, cancelled: false };
  }
  return {
    logs,
    result: undefined,
    error: cancelled ? "exec was cancelled." : `exec timed out after ${Math.round(input.timeoutMs / 1000)}s.`,
    timedOut: !cancelled,
    cancelled
  };
}

// A script stopped mid-await still owns promise handles inside the VM; the release build frees the
// whole runtime regardless, so a failed leak check here is not worth surfacing to the agent.
function disposeQuietly(context: QuickJSContext, runtime: QuickJSRuntime): void {
  try {
    context.dispose();
    runtime.dispose();
  } catch {
    // Ignore leak assertions from an interrupted script.
  }
}
