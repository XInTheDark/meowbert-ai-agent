import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { BridgeServerStatus, BridgeToolMode } from "@meowbert/shared";
import type { BridgeMcpToolResult } from "@meowbert/run-executor/bridge/bridge-mcp-translation";
import type { BridgeRegistry } from "./bridge-registry";
import { listBridgeMcpTools, resolveCoreMeowbertToolName } from "./bridge-tool-catalog";

export const DEFAULT_BRIDGE_MCP_PORT = 38471;

export interface BridgeMcpServerOptions {
  registry: BridgeRegistry;
  bearerToken: string;
  toolMode?: BridgeToolMode;
  preferredPort?: number;
}

function constantTimeTokenMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isAllowedHostHeader(host: string | null, port: number): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}`;
}

function textErrorResult(text: string): BridgeMcpToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function jsonErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function readIncomingBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export class BridgeMcpServer {
  private readonly registry: BridgeRegistry;
  private httpServer: HttpServer | null = null;
  private listeningPort: number | null = null;
  private bearerToken: string;
  private toolMode: BridgeToolMode;
  private preferredPort: number;
  private lastError: string | null = null;

  constructor(options: BridgeMcpServerOptions) {
    this.registry = options.registry;
    this.bearerToken = options.bearerToken;
    this.toolMode = options.toolMode ?? "standard";
    this.preferredPort = options.preferredPort ?? DEFAULT_BRIDGE_MCP_PORT;
  }

  getStatus(): BridgeServerStatus {
    return {
      running: this.httpServer !== null && this.listeningPort !== null,
      endpointUrl: this.listeningPort !== null ? `http://127.0.0.1:${this.listeningPort}/mcp` : null,
      port: this.listeningPort,
      bearerToken: this.bearerToken,
      toolMode: this.toolMode,
      error: this.lastError
    };
  }

  reconfigure(input: { bearerToken?: string; toolMode?: BridgeToolMode }): BridgeServerStatus {
    if (typeof input.bearerToken === "string" && input.bearerToken.trim()) {
      this.bearerToken = input.bearerToken.trim();
    }
    if (input.toolMode === "standard" || input.toolMode === "compact") {
      this.toolMode = input.toolMode;
    }
    return this.getStatus();
  }

  async start(): Promise<BridgeServerStatus> {
    if (this.httpServer && this.listeningPort !== null) {
      return this.getStatus();
    }
    this.lastError = null;
    try {
      await this.listenOn(this.preferredPort);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (this.preferredPort !== 0 && code === "EADDRINUSE") {
        await this.listenOn(0);
      } else {
        this.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }
    return this.getStatus();
  }

  private listenOn(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleNodeRequest(req, res);
      });
      const onError = (err: Error) => {
        server.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        const addr = server.address() as AddressInfo | null;
        this.httpServer = server;
        this.listeningPort = addr?.port ?? port;
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
  }

  async stop(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = null;
    this.listeningPort = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private createRequestMcpServer(): McpServer {
    const server = new McpServer(
      { name: "meowbert-bridge", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: listBridgeMcpTools(this.toolMode).map((spec) => ({
        name: spec.mcpName,
        description: spec.description,
        inputSchema: spec.inputSchema
      }))
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await this.dispatchMcpToolCall(
        request.params.name,
        (request.params.arguments ?? {}) as Record<string, unknown>
      );
      return result as unknown as Record<string, unknown>;
    });

    return server;
  }

  private async dispatchMcpToolCall(name: string, rawArgs: Record<string, unknown>): Promise<BridgeMcpToolResult> {
    const sessionCode = typeof rawArgs.session_code === "string" ? rawArgs.session_code.trim() : "";
    if (!sessionCode) {
      return textErrorResult("Missing required `session_code`.");
    }
    const entry = this.registry.getByCode(sessionCode);
    if (!entry) {
      return textErrorResult(`Unknown or expired Meowbert bridge session_code "${sessionCode}".`);
    }

    if (name === "meowbert_start") {
      return entry.session.claimStart();
    }
    if (name === "meowbert_list_tools") {
      const tools = entry.session.listAvailableTools();
      return { content: [{ type: "text", text: JSON.stringify({ tools }, null, 2) }] };
    }
    if (name === "meowbert_call_tool") {
      const toolName = typeof rawArgs.tool_name === "string" ? rawArgs.tool_name.trim() : "";
      if (!toolName) return textErrorResult("Missing required `tool_name`.");
      const toolArgs = rawArgs.arguments && typeof rawArgs.arguments === "object" && !Array.isArray(rawArgs.arguments)
        ? rawArgs.arguments as Record<string, unknown>
        : {};
      return entry.session.invokeTool(toolName, toolArgs);
    }

    const mappedName = resolveCoreMeowbertToolName(name);
    if (!mappedName) {
      return textErrorResult(`Unknown Meowbert bridge tool "${name}". Call meowbert_list_tools to see available tools.`);
    }
    const { session_code: _sessionCode, ...forwardedArgs } = rawArgs;
    return entry.session.invokeTool(mappedName, forwardedArgs);
  }

  async handleWebRequest(request: Request, expectedPort = this.listeningPort ?? this.preferredPort): Promise<Response> {
    const hostHeader = request.headers.get("host") ?? new URL(request.url).host;
    if (!isAllowedHostHeader(hostHeader, expectedPort)) {
      return jsonErrorResponse(403, "Forbidden Host header.");
    }
    const origin = request.headers.get("origin");
    if (origin && origin.trim().length > 0) {
      return jsonErrorResponse(403, "Cross-origin browser requests are forbidden.");
    }
    const authHeader = (request.headers.get("authorization") ?? "").trim();
    const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!providedToken || !constantTimeTokenMatch(providedToken, this.bearerToken)) {
      return jsonErrorResponse(401, "Unauthorized.");
    }

    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== "/mcp") {
      return jsonErrorResponse(404, "Not found.");
    }
    if (request.method !== "POST") {
      return jsonErrorResponse(405, "Method not allowed; use POST /mcp.");
    }

    const mcpServer = this.createRequestMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    try {
      await mcpServer.connect(transport);
      return await transport.handleRequest(request);
    } catch (error) {
      return jsonErrorResponse(500, error instanceof Error ? error.message : String(error));
    } finally {
      void transport.close().catch(() => undefined);
      void mcpServer.close().catch(() => undefined);
    }
  }

  private async handleNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = this.listeningPort;
    if (port === null) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Bridge server is not ready." }));
      return;
    }
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
          for (const entry of value) headers.append(key, entry);
        } else if (typeof value === "string") {
          headers.set(key, value);
        }
      }
      const method = req.method ?? "GET";
      const body = method === "GET" || method === "HEAD" ? undefined : await readIncomingBody(req);
      const webReq = new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
        method,
        headers,
        ...(body ? { body: new Uint8Array(body) } : {})
      });
      const webRes = await this.handleWebRequest(webReq, port);
      const outHeaders: Record<string, string> = {};
      webRes.headers.forEach((value, key) => { outHeaders[key] = value; });
      res.writeHead(webRes.status, outHeaders);
      const buf = Buffer.from(await webRes.arrayBuffer());
      res.end(buf);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }
}
