import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { SkillManifest, SkillManifestMcpStdio, SkillManifestMcpSse } from "@meowbert/shared";
import type { DockerSandboxHandle, SandboxAttachedProcess } from "@meowbert/shared/docker-sandbox";
import type { FunctionTool } from "openai/resources/responses/responses";
import { compactToolInputSchema } from "./mcp-schema-compaction.js";

export interface McpConnection {
  client: Client;
  transport: Transport;
  skillId: string;
  requestTimeoutMs: number;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const SKILL_TOOL_SEPARATOR = "__";

const DEFAULT_SANDBOX_STDIO_ENV: Record<string, string> = {
  HOME: "/tmp",
  TMPDIR: "/tmp",
  XDG_CACHE_HOME: "/tmp/.cache",
  npm_config_cache: "/tmp/.npm"
};

const SKILL_DIR_PLACEHOLDER = "{{SKILL_DIR}}";
const SKILL_ENV_PLACEHOLDER_PATTERN = /\{\{ENV:([A-Z0-9_]+)(?::-([^}]*))?\}\}/g;
const MCP_DEBUG_TAIL_LIMIT = 4_000;

export function buildSandboxStdioEnv(env?: Record<string, string>): Record<string, string> {
  return {
    ...DEFAULT_SANDBOX_STDIO_ENV,
    ...(env ?? {})
  };
}

function resolveSkillTemplateString(value: string, skillDir: string): string {
  const withSkillDir = value.replaceAll(SKILL_DIR_PLACEHOLDER, skillDir);
  return withSkillDir.replace(SKILL_ENV_PLACEHOLDER_PATTERN, (_match, envName: string, defaultValue: string | undefined) => {
    const envValue = process.env[envName];
    if (typeof envValue !== "string" || envValue.length === 0) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new Error(`Skill requires environment variable ${envName}, but it is not set in the worker environment.`);
    }
    return envValue;
  });
}

export function resolveSkillStdioEnv(env: Record<string, string> | undefined, skillDir: string): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, resolveSkillTemplateString(value, skillDir)])
  );
}

function mergeResolvedSkillEnv(input: {
  manifestEnv?: Record<string, string>;
  runtimeEnv?: Record<string, string>;
  skillDir: string;
}): Record<string, string> | undefined {
  const resolvedManifestEnv = resolveSkillStdioEnv(input.manifestEnv, input.skillDir);
  if (!resolvedManifestEnv && !input.runtimeEnv) {
    return undefined;
  }

  return {
    ...(resolvedManifestEnv ?? {}),
    ...(input.runtimeEnv ?? {})
  };
}

export function providerSafeSkillToolId(skillId: string): string {
  const sanitized = skillId.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

export function skillToolPrefix(skillId: string): string {
  return `${providerSafeSkillToolId(skillId)}${SKILL_TOOL_SEPARATOR}`;
}

export function skillToolName(skillId: string, toolName: string): string {
  return `${skillToolPrefix(skillId)}${toolName}`;
}

export function parseSkillToolName(prefixedName: string): { skillId: string; toolName: string } | null {
  const idx = prefixedName.indexOf(SKILL_TOOL_SEPARATOR);
  if (idx < 0) {
    return null;
  }
  return {
    skillId: prefixedName.slice(0, idx),
    toolName: prefixedName.slice(idx + SKILL_TOOL_SEPARATOR.length)
  };
}

function appendTextTail(current: string, chunk: Buffer): string {
  const combined = `${current}${chunk.toString("utf8")}`;
  return combined.length <= MCP_DEBUG_TAIL_LIMIT
    ? combined
    : combined.slice(combined.length - MCP_DEBUG_TAIL_LIMIT);
}

function formatMcpStartupDiagnostics(input: {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  transportError: Error | null;
  stderrTail: string;
}): string {
  const parts = [
    `MCP startup command: ${[input.command, ...input.args].join(" ")}`,
    `MCP startup cwd: ${input.cwd}`
  ];

  if (input.exitCode !== null) {
    parts.push(`MCP process exit code: ${input.exitCode}`);
  }
  if (input.transportError) {
    parts.push(`MCP transport error: ${input.transportError.message}`);
  }
  if (input.stderrTail.trim().length > 0) {
    parts.push(`MCP stderr tail:\n${input.stderrTail.trimEnd()}`);
  }

  return parts.join("\n");
}

class SandboxStdioClientTransport implements Transport {
  private readonly sandbox: DockerSandboxHandle;
  private readonly command: string;
  private readonly args: string[];
  private readonly env: Record<string, string> | undefined;
  private readonly cwd: string;
  private readonly readBuffer = new ReadBuffer();
  private process: SandboxAttachedProcess | null = null;
  private stderrTail = "";
  private exitCode: number | null = null;
  private transportError: Error | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T>(message: T) => void;

  constructor(input: {
    sandbox: DockerSandboxHandle;
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd: string;
  }) {
    this.sandbox = input.sandbox;
    this.command = input.command;
    this.args = input.args;
    this.env = input.env;
    this.cwd = input.cwd;
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("SandboxStdioClientTransport already started.");
    }

    this.process = await this.sandbox.startAttachedProcess({
      command: [this.command, ...this.args],
      workingDir: this.cwd,
      env: buildSandboxStdioEnv(this.env),
      tty: false,
      stdin: true
    });

    this.process.stdout.on("data", (chunk: Buffer) => {
      this.readBuffer.append(chunk);
      this.processReadBuffer();
    });

    this.process.stdout.on("error", (error) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.transportError = normalized;
      this.onerror?.(normalized);
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = appendTextTail(this.stderrTail, chunk);
    });

    void this.process.waitForExit()
      .then((exitCode) => {
        this.exitCode = exitCode;
        this.process = null;
        this.onclose?.();
      })
      .catch((error) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.transportError = normalized;
        this.onerror?.(normalized);
      });
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  async close(): Promise<void> {
    const process = this.process;
    this.process = null;
    if (!process) {
      this.readBuffer.clear();
      return;
    }

    await process.close();
    this.readBuffer.clear();
  }

  async send(message: unknown): Promise<void> {
    if (!this.process?.stdin) {
      throw new Error("Not connected");
    }

    const payload = serializeMessage(message as never);
    await new Promise<void>((resolve, reject) => {
      const writable = this.process?.stdin;
      if (!writable) {
        reject(new Error("Not connected"));
        return;
      }

      const handledError = (error: Error): void => {
        writable.removeListener("drain", handledDrain);
        reject(error);
      };
      const handledDrain = (): void => {
        writable.removeListener("error", handledError);
        resolve();
      };

      writable.once("error", handledError);
      if (writable.write(payload)) {
        writable.removeListener("error", handledError);
        resolve();
        return;
      }

      writable.once("drain", handledDrain);
    });
  }

  getStartupDiagnostics(): string {
    return formatMcpStartupDiagnostics({
      command: this.command,
      args: this.args,
      cwd: this.cwd,
      exitCode: this.exitCode,
      transportError: this.transportError,
      stderrTail: this.stderrTail
    });
  }
}

function createStdioTransport(
  mcpConfig: SkillManifestMcpStdio,
  skillDir: string,
  sandbox: DockerSandboxHandle,
  runtimeEnv?: Record<string, string>
): Transport {
  const cwd = mcpConfig.cwd
    ? resolveSkillTemplateString(mcpConfig.cwd, skillDir)
    : skillDir;

  return new SandboxStdioClientTransport({
    sandbox,
    command: mcpConfig.command,
    args: mcpConfig.args ?? [],
    env: mergeResolvedSkillEnv({
      manifestEnv: mcpConfig.env,
      runtimeEnv,
      skillDir
    }),
    cwd
  });
}

function createSseTransport(mcpConfig: SkillManifestMcpSse): Transport {
  return new SSEClientTransport(new URL(mcpConfig.url));
}

export async function startMcpServer(
  manifest: SkillManifest,
  skillDir: string,
  sandbox: DockerSandboxHandle,
  requestTimeoutMs = 60_000,
  runtimeEnv?: Record<string, string>
): Promise<McpConnection> {
  const client = new Client(
    { name: "meowbert-worker", version: "0.1.0" },
    { capabilities: {} }
  );

  const transport = manifest.mcp.transport === "stdio"
    ? createStdioTransport(manifest.mcp, skillDir, sandbox, runtimeEnv)
    : createSseTransport(manifest.mcp);

  try {
    await client.connect(transport, { timeout: requestTimeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostics = transport instanceof SandboxStdioClientTransport
      ? transport.getStartupDiagnostics()
      : null;
    try {
      await transport.close();
    } catch {
      // Best-effort cleanup after failed startup.
    }
    throw new Error(diagnostics ? `${message}\n${diagnostics}` : message);
  }

  return { client, transport, skillId: manifest.id, requestTimeoutMs };
}

export async function listMcpTools(connection: McpConnection): Promise<McpToolDefinition[]> {
  let result;
  try {
    result = await connection.client.listTools(undefined, { timeout: connection.requestTimeoutMs });
  } catch (error) {
    if (error instanceof McpError && error.code === ErrorCode.MethodNotFound) {
      return [];
    }
    throw error;
  }
  return (result.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>
  }));
}

export function mcpToolsToFunctionTools(skillId: string, mcpTools: McpToolDefinition[]): FunctionTool[] {
  return mcpTools.map((tool) => ({
    type: "function" as const,
    name: skillToolName(skillId, tool.name),
    description: tool.description,
    strict: false,
    parameters: compactToolInputSchema(tool.inputSchema)
  }));
}

function extractStructuredMcpPayload(result: Record<string, unknown>): unknown {
  if ("structuredContent" in result && result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const rest = Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "content")
  );
  return Object.keys(rest).length > 0 ? rest : null;
}

export async function callMcpTool(
  connection: McpConnection,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const result = await connection.client.callTool({
    name: toolName,
    arguments: args
  }, undefined, { timeout: connection.requestTimeoutMs });

  if (Array.isArray(result.content)) {
    const textParts = result.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text);
    if (textParts.length > 0) {
      return textParts.join("\n");
    }

    const structuredPayload = extractStructuredMcpPayload(result as Record<string, unknown>);
    if (structuredPayload !== null) {
      return JSON.stringify(structuredPayload);
    }

    return JSON.stringify(result.content);
  }

  return JSON.stringify(result);
}

export async function stopMcpServer(connection: McpConnection): Promise<void> {
  try {
    await connection.client.close();
  } catch {
    // Best-effort cleanup
  }
  try {
    await connection.transport.close();
  } catch {
    // Best-effort cleanup
  }
}
