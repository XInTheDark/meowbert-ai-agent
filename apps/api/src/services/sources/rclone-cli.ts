import { execFile as execFileCallback, spawn } from "node:child_process";
import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { assertSourceProviderRuntimeEnabled } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import type { RcloneSourceConfig } from "./rclone-config.js";

const execFile = promisify(execFileCallback);
const RCLONE_COMMAND_TIMEOUT_MS = 120_000;
const RCLONE_JSON_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

let rcloneBinaryPromise: Promise<string> | null = null;
const rcloneConfigPathPromises = new Map<string, Promise<string>>();

export class RcloneCommandError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly statusCode: number;
  readonly exposeMessage = true;

  constructor(message: string, options: { stderr?: string; exitCode?: number | null; statusCode?: number } = {}) {
    super(message);
    this.name = "RcloneCommandError";
    this.stderr = options.stderr ?? "";
    this.exitCode = options.exitCode ?? null;
    this.statusCode = options.statusCode ?? 502;
  }
}

export interface RcloneListJsonItem {
  ID?: string;
  OrigID?: string;
  Name?: string;
  Path?: string;
  IsDir?: boolean;
  MimeType?: string;
  ModTime?: string;
  Size?: number;
  Hashes?: Record<string, string>;
}

function formatCommandError(error: unknown, prefix: string): RcloneCommandError {
  if (error instanceof RcloneCommandError) {
    return error;
  }

  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  const message = stderr || (error instanceof Error ? error.message : String(error));
  const exitCode = typeof record.code === "number" ? record.code : null;
  return new RcloneCommandError(`${prefix}: ${message}`, { stderr, exitCode });
}

export async function ensureRcloneBinary(): Promise<string> {
  assertSourceProviderRuntimeEnabled("rclone");
  if (!rcloneBinaryPromise) {
    rcloneBinaryPromise = (async () => {
      try {
        await execFile("rclone", ["version"], {
          timeout: 10_000,
          maxBuffer: 1024 * 1024
        });
        return "rclone";
      } catch (error) {
        rcloneBinaryPromise = null;
        const details = formatCommandError(error, "rclone availability check failed");
        throw new RcloneCommandError(
          "rclone is not installed or is not available on PATH for the API runtime. Install rclone in the API image or host before using the rclone source.",
          {
            stderr: details.stderr,
            exitCode: details.exitCode,
            statusCode: 503
          }
        );
      }
    })();
  }

  return rcloneBinaryPromise;
}

function getRcloneConfigCacheRoot(): string {
  return path.join(path.dirname(config.runtime.tasksRoot), ".meowbert-rclone", "configs");
}

function getRcloneConfigCacheKey(sourceConfig: RcloneSourceConfig): string {
  return crypto.createHash("sha256").update(sourceConfig.rcloneConfig).digest("hex");
}

export async function ensureRcloneConfigFile(sourceConfig: RcloneSourceConfig): Promise<string> {
  assertSourceProviderRuntimeEnabled("rclone");
  const cacheKey = getRcloneConfigCacheKey(sourceConfig);
  let configPathPromise = rcloneConfigPathPromises.get(cacheKey);
  if (!configPathPromise) {
    configPathPromise = (async () => {
      const cacheRoot = getRcloneConfigCacheRoot();
      const configDir = path.join(cacheRoot, cacheKey);
      const configPath = path.join(configDir, "rclone.conf");

      await fsPromises.mkdir(configDir, { recursive: true, mode: 0o700 });
      await fsPromises.writeFile(configPath, sourceConfig.rcloneConfig, { mode: 0o600 });
      await fsPromises.chmod(configPath, 0o600);
      return configPath;
    })().catch((error) => {
      rcloneConfigPathPromises.delete(cacheKey);
      throw error;
    });
    rcloneConfigPathPromises.set(cacheKey, configPathPromise);
  }

  return configPathPromise;
}

async function withRcloneConfig<T>(
  sourceConfig: RcloneSourceConfig,
  execute: (configPath: string) => Promise<T>
): Promise<T> {
  const configPath = await ensureRcloneConfigFile(sourceConfig);
  return execute(configPath);
}

export async function runRclone(input: {
  sourceConfig: RcloneSourceConfig;
  args: string[];
  timeoutMs?: number;
  maxBuffer?: number;
}): Promise<{ stdout: string; stderr: string }> {
  const binary = await ensureRcloneBinary();
  return withRcloneConfig(input.sourceConfig, async (configPath) => {
    try {
      return await execFile(binary, ["--config", configPath, ...input.args], {
        timeout: input.timeoutMs ?? RCLONE_COMMAND_TIMEOUT_MS,
        maxBuffer: input.maxBuffer ?? RCLONE_JSON_MAX_BUFFER_BYTES
      });
    } catch (error) {
      throw formatCommandError(error, `rclone ${input.args[0] ?? "command"} failed`);
    }
  });
}

export async function rcloneLsjson(input: {
  sourceConfig: RcloneSourceConfig;
  remotePath: string;
  recursive?: boolean;
  stat?: boolean;
  hash?: boolean;
}): Promise<RcloneListJsonItem[] | RcloneListJsonItem> {
  const args = ["lsjson", input.remotePath];
  if (input.hash) {
    args.push("--hash");
  }
  if (!input.stat) {
    args.push("--no-mimetype");
  }
  if (!input.recursive && !input.stat) {
    args.push("--disable", "ListR");
  }
  if (input.recursive) {
    args.push("--recursive");
  }
  if (input.stat) {
    args.push("--stat");
  }

  const { stdout } = await runRclone({
    sourceConfig: input.sourceConfig,
    args
  });
  const parsed = JSON.parse(stdout || (input.stat ? "{}" : "[]")) as unknown;
  if (input.stat) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("rclone stat returned invalid JSON.");
    }
    return parsed as RcloneListJsonItem;
  }
  if (!Array.isArray(parsed)) {
    throw new Error("rclone lsjson returned invalid JSON.");
  }
  return parsed as RcloneListJsonItem[];
}

export async function rcloneCopyTo(input: {
  sourceConfig: RcloneSourceConfig;
  sourcePath: string;
  destinationPath: string;
}): Promise<void> {
  await runRclone({
    sourceConfig: input.sourceConfig,
    args: ["copyto", input.sourcePath, input.destinationPath, "--ignore-times", "--metadata"],
    timeoutMs: 30 * 60_000
  });
}

export async function rcloneMkdir(input: {
  sourceConfig: RcloneSourceConfig;
  remotePath: string;
}): Promise<void> {
  await runRclone({
    sourceConfig: input.sourceConfig,
    args: ["mkdir", input.remotePath]
  });
}

export async function rcloneDeleteFile(input: {
  sourceConfig: RcloneSourceConfig;
  remotePath: string;
}): Promise<void> {
  await runRclone({
    sourceConfig: input.sourceConfig,
    args: ["deletefile", input.remotePath]
  });
}

export async function rclonePurge(input: {
  sourceConfig: RcloneSourceConfig;
  remotePath: string;
}): Promise<void> {
  await runRclone({
    sourceConfig: input.sourceConfig,
    args: ["purge", input.remotePath]
  });
}

export async function createRcloneCatResponse(input: {
  sourceConfig: RcloneSourceConfig;
  remotePath: string;
}): Promise<Response> {
  const binary = await ensureRcloneBinary();
  const configPath = await ensureRcloneConfigFile(input.sourceConfig);

  const child = spawn(binary, ["--config", configPath, "cat", input.remotePath], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.on("error", (error) => {
    child.stdout.destroy(error);
  });
  child.on("close", (code) => {
    if (code !== 0) {
      child.stdout.destroy(new RcloneCommandError(`rclone cat failed: ${stderr.trim() || `exit ${code}`}`, {
        stderr,
        exitCode: code
      }));
    }
  });

  return new Response(Readable.toWeb(child.stdout) as unknown as BodyInit);
}
