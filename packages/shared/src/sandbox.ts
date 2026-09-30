import { z } from "zod";

export const DEFAULT_SANDBOX_DOCKER_HOST = "unix:///var/run/docker.sock";
export const DEFAULT_SANDBOX_START_TIMEOUT_MS = 30_000;
export const DEFAULT_SANDBOX_SESSION_IDLE_TIMEOUT_MS = 45 * 60 * 1000;
export const DEFAULT_SANDBOX_PIDS_LIMIT = 256;

export const sandboxResourcesSchema = z.object({
  pids: z.number().int().positive().default(DEFAULT_SANDBOX_PIDS_LIMIT),
  memoryMb: z.number().int().positive().optional(),
  cpus: z.number().positive().optional(),
  storageMb: z.number().int().positive().optional()
});

export const sandboxConfigSchema = z.object({
  provider: z.literal("docker"),
  image: z.string().min(1),
  runtime: z.string().min(1).optional(),
  dockerHost: z.string().min(1).default(DEFAULT_SANDBOX_DOCKER_HOST),
  startTimeoutMs: z.number().int().positive().default(DEFAULT_SANDBOX_START_TIMEOUT_MS),
  sessionIdleTimeoutMs: z.number().int().positive().default(DEFAULT_SANDBOX_SESSION_IDLE_TIMEOUT_MS),
  envPassthroughPatterns: z.array(z.string().min(1)).default([]),
  resources: sandboxResourcesSchema
});

export type SandboxConfig = z.infer<typeof sandboxConfigSchema>;
export type SandboxResourcesConfig = z.infer<typeof sandboxResourcesSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSandboxPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(payload.sandbox) ? payload.sandbox : {};
}

export function getSandboxNetworkEnabled(payload: Record<string, unknown>): boolean {
  const sandbox = asSandboxPayload(payload);
  return sandbox.network_enabled !== false && sandbox.networkEnabled !== false;
}

export function setSandboxNetworkEnabled(
  payload: Record<string, unknown>,
  enabled: boolean
): Record<string, unknown> {
  const normalized = { ...payload };
  const sandbox = isPlainObject(normalized.sandbox)
    ? { ...normalized.sandbox }
    : {};

  if (enabled) {
    delete sandbox.network_enabled;
    delete sandbox.networkEnabled;
  } else {
    sandbox.network_enabled = false;
    delete sandbox.networkEnabled;
  }

  if (Object.keys(sandbox).length === 0) {
    delete normalized.sandbox;
  } else {
    normalized.sandbox = sandbox;
  }

  return normalized;
}

export function escapeEnvPattern(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesEnvPassthroughPattern(name: string, pattern: string): boolean {
  return escapeEnvPattern(pattern).test(name);
}

export function selectSandboxPassthroughEnv(
  sourceEnv: NodeJS.ProcessEnv,
  patterns: string[]
): Record<string, string> {
  const selected: Record<string, string> = {};

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value !== "string") {
      continue;
    }

    if (!patterns.some((pattern) => matchesEnvPassthroughPattern(key, pattern))) {
      continue;
    }

    selected[key] = value;
  }

  return selected;
}
