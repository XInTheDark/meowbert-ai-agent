import type Docker from "dockerode";

const EVENT_TAIL_MAX_CHARS = 4096;
const EVENT_LOOKBACK_SECONDS = 24 * 60 * 60;
const HIDDEN_EVENT_ATTRIBUTE_PREFIXES = ["com.meowbert.", "org.opencontainers."];

export interface SandboxContainerLimits {
  memoryMb: number | null;
  cpus: number | null;
  pids: number | null;
}

export interface SandboxCrashReport {
  containerId: string;
  state: {
    status: string | null;
    exitCode: number | null;
    oomKilled: boolean | null;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
  limits: SandboxContainerLimits | null;
  recentEvents: string;
}

interface DockerEventMessage {
  Action?: string;
  status?: string;
  timeNano?: number;
  time?: number;
  Actor?: { Attributes?: Record<string, string> };
}

function isMissingContainerError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { statusCode?: unknown }).statusCode === 404;
}

function positiveOrNull(value: number | undefined | null): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function readContainerLimits(hostConfig: Docker.HostConfig | undefined): SandboxContainerLimits {
  const memoryBytes = positiveOrNull(hostConfig?.Memory);
  const nanoCpus = positiveOrNull(hostConfig?.NanoCpus);
  return {
    memoryMb: memoryBytes === null ? null : Math.round(memoryBytes / (1024 * 1024)),
    cpus: nanoCpus === null ? null : nanoCpus / 1_000_000_000,
    pids: positiveOrNull(hostConfig?.PidsLimit)
  };
}

function formatEventLine(event: DockerEventMessage): string | null {
  const action = event.Action ?? event.status ?? "";
  if (!action || action.startsWith("exec_")) {
    return null;
  }
  const timeMs = typeof event.timeNano === "number" ? event.timeNano / 1_000_000 : (event.time ?? 0) * 1000;
  const attributes = Object.entries(event.Actor?.Attributes ?? {})
    .filter(([key]) => !HIDDEN_EVENT_ATTRIBUTE_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .map(([key, value]) => `${key}=${value}`);
  return [new Date(timeMs).toISOString(), action, ...attributes].join(" ");
}

export function tailSandboxEventLog(rawEvents: string): string {
  const lines = rawEvents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return formatEventLine(JSON.parse(line) as DockerEventMessage);
      } catch {
        return null;
      }
    })
    .filter((line): line is string => line !== null);

  const tail: string[] = [];
  let length = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    length += lines[index].length + 1;
    if (length > EVENT_TAIL_MAX_CHARS && tail.length > 0) {
      break;
    }
    tail.unshift(lines[index]);
  }
  return tail.join("\n");
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readRecentEvents(docker: Docker, containerId: string, createdAt: string | null): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const createdSeconds = createdAt ? Math.floor(Date.parse(createdAt) / 1000) : Number.NaN;
  const stream = await docker.getEvents({
    since: Number.isFinite(createdSeconds) ? createdSeconds : nowSeconds - EVENT_LOOKBACK_SECONDS,
    until: nowSeconds + 1,
    filters: { type: ["container"], container: [containerId] }
  });
  return tailSandboxEventLog(await readStream(stream));
}

/**
 * Collects Docker's own facts about a sandbox container that is no longer running.
 * Returns null while the container is still running normally.
 */
export async function readSandboxCrashReport(docker: Docker, containerId: string): Promise<SandboxCrashReport | null> {
  let inspect: Docker.ContainerInspectInfo | null = null;
  try {
    inspect = await docker.getContainer(containerId).inspect();
  } catch (error) {
    if (!isMissingContainerError(error)) {
      throw error;
    }
  }
  if (inspect?.State?.Running === true && inspect.State.Paused !== true) {
    return null;
  }

  const recentEvents = await readRecentEvents(docker, containerId, inspect?.Created ?? null).catch(
    (error: unknown) => `Unable to read Docker events: ${error instanceof Error ? error.message : String(error)}`
  );
  return {
    containerId,
    state: inspect
      ? {
          status: inspect.State?.Status ?? null,
          exitCode: typeof inspect.State?.ExitCode === "number" ? inspect.State.ExitCode : null,
          oomKilled: typeof inspect.State?.OOMKilled === "boolean" ? inspect.State.OOMKilled : null,
          error: inspect.State?.Error || null,
          startedAt: inspect.State?.StartedAt ?? null,
          finishedAt: inspect.State?.FinishedAt ?? null
        }
      : null,
    limits: inspect ? readContainerLimits(inspect.HostConfig) : null,
    recentEvents
  };
}

export function formatSandboxCrashReport(report: SandboxCrashReport): string {
  const lines = [
    `Container ${report.containerId.slice(0, 12)} state: ${report.state ? JSON.stringify(report.state) : "removed"}`
  ];
  if (report.limits) {
    lines.push(`Limits: ${JSON.stringify(report.limits)}${report.limits.memoryMb === null ? "" : " (files in /tmp count toward memory)"}`);
  }
  lines.push(`Recent Docker events:\n${report.recentEvents || "(none recorded)"}`);
  return lines.join("\n");
}
