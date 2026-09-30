import path from "node:path";
import type { DockerSandboxHandle, SandboxAttachedProcess } from "@meowbert/shared/docker-sandbox";
import { resolveWorkspaceEnvironmentReadableMountPaths } from "@meowbert/shared";
import { apiSandboxManager } from "../runtime/sandbox.js";
import { resolveUserSandboxContainerResources } from "../users/resource-limits.js";
import type { ProjectCanvasSummary } from "./project-canvases.js";

interface CanvasDevServerSession {
  canvasId: string;
  ownerUserId: string;
  workspaceId: string;
  environmentId: string;
  environmentRootPath: string;
  workspaceRootPath: string;
  canvasDir: string;
  command: string;
  containerPort: number;
  hostPort: number;
  startedAt: string;
  lastActiveAt: string;
  sandbox: DockerSandboxHandle;
  process: SandboxAttachedProcess;
}

export interface CanvasDevServerStatus {
  status: "stopped" | "running";
  canvasId: string;
  command: string | null;
  port: number | null;
  startedAt: string | null;
  lastActiveAt: string | null;
}

const sessions = new Map<string, CanvasDevServerSession>();
const startingCanvasCounts = new Map<string, number>();

export function listActiveCanvasSandboxSessionIds(): string[] {
  return [...new Set([...sessions.keys(), ...startingCanvasCounts.keys()])].map((id) => `canvas-${id}`);
}
const DEFAULT_DEV_COMMAND = "npm install && npm run dev -- --host 0.0.0.0";
const DEFAULT_DEV_PORT = 5173;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function normalizeDevCommand(canvas: ProjectCanvasSummary): string {
  const command = canvas.devServer.command;
  return typeof command === "string" && command.trim().length > 0
    ? command.trim()
    : DEFAULT_DEV_COMMAND;
}

function normalizeDevPort(canvas: ProjectCanvasSummary): number {
  const port = canvas.devServer.port;
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535
    ? port
    : DEFAULT_DEV_PORT;
}

function touch(session: CanvasDevServerSession): void {
  session.lastActiveAt = new Date().toISOString();
}

async function closeSession(session: CanvasDevServerSession): Promise<void> {
  sessions.delete(session.canvasId);
  await session.process.close().catch(() => {});
  await session.sandbox.stop().catch(() => {});
}

export function getCanvasDevServerStatus(canvasId: string): CanvasDevServerStatus {
  const session = sessions.get(canvasId);
  if (!session) {
    return {
      status: "stopped",
      canvasId,
      command: null,
      port: null,
      startedAt: null,
      lastActiveAt: null
    };
  }

  touch(session);
  return {
    status: "running",
    canvasId,
    command: session.command,
    port: session.containerPort,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt
  };
}

interface StartCanvasDevServerInput {
  canvas: ProjectCanvasSummary;
  ownerUserId: string;
  environmentRootPath: string;
  workspaceRootPath: string;
  runAsRoot?: boolean;
}

export async function startCanvasDevServer(input: StartCanvasDevServerInput): Promise<CanvasDevServerStatus> {
  startingCanvasCounts.set(input.canvas.id, (startingCanvasCounts.get(input.canvas.id) ?? 0) + 1);
  try {
    return await createCanvasDevServer(input);
  } finally {
    const remaining = (startingCanvasCounts.get(input.canvas.id) ?? 1) - 1;
    if (remaining > 0) startingCanvasCounts.set(input.canvas.id, remaining);
    else startingCanvasCounts.delete(input.canvas.id);
  }
}

async function createCanvasDevServer(input: StartCanvasDevServerInput): Promise<CanvasDevServerStatus> {
  const existing = sessions.get(input.canvas.id);
  if (existing) {
    touch(existing);
    return getCanvasDevServerStatus(input.canvas.id);
  }

  const canvasDir = path.resolve(input.environmentRootPath, input.canvas.rootPath);
  const command = normalizeDevCommand(input.canvas);
  const containerPort = normalizeDevPort(input.canvas);
  const resources = await resolveUserSandboxContainerResources(input.ownerUserId);
  const sandbox = await apiSandboxManager.createPersistentSandbox({
    workingDir: canvasDir,
    networkEnabled: true,
    mounts: await resolveWorkspaceEnvironmentReadableMountPaths({
      envRoot: input.environmentRootPath,
      workspaceRoot: input.workspaceRootPath
    }).then((mounts) => mounts.map((mount) => ({ path: mount }))),
    ports: [{ containerPort, hostIp: "127.0.0.1" }],
    runAsRoot: input.runAsRoot,
    resources,
    env: {
      CANVAS_DIR: canvasDir,
      MEOWBERT_CANVAS_DIR: canvasDir,
      CANVAS_ID: input.canvas.id,
      CANVAS_ENTRY_PATH: input.canvas.entryPath,
      WORKSPACE_ROOT: input.workspaceRootPath,
      MEOWBERT_WORKSPACE_ROOT: input.workspaceRootPath,
      MEOWBERT_ENV_ROOT: input.environmentRootPath
    },
    labels: {
      purpose: "shell-session",
      workspaceId: input.canvas.workspaceId,
      environmentId: input.canvas.projectId,
      sessionId: `canvas-${input.canvas.id}`
    }
  });

  const process = await sandbox.startAttachedProcess({
    command: ["/bin/bash", "-lc", command],
    workingDir: canvasDir,
    tty: false,
    stdin: false,
    env: {
      CANVAS_DIR: canvasDir,
      MEOWBERT_CANVAS_DIR: canvasDir,
      CANVAS_ID: input.canvas.id,
      CANVAS_ENTRY_PATH: input.canvas.entryPath,
      HOST: "0.0.0.0",
      PORT: String(containerPort)
    }
  });
  const hostPort = await sandbox.getMappedHostPort(containerPort);
  if (!hostPort) {
    await process.close().catch(() => {});
    await sandbox.stop().catch(() => {});
    throw new Error("Failed to expose canvas dev server port");
  }

  const now = new Date().toISOString();
  sessions.set(input.canvas.id, {
    canvasId: input.canvas.id,
    ownerUserId: input.ownerUserId,
    workspaceId: input.canvas.workspaceId,
    environmentId: input.canvas.projectId,
    environmentRootPath: input.environmentRootPath,
    workspaceRootPath: input.workspaceRootPath,
    canvasDir,
    command,
    containerPort,
    hostPort,
    startedAt: now,
    lastActiveAt: now,
    sandbox,
    process
  });

  return getCanvasDevServerStatus(input.canvas.id);
}

export async function stopCanvasDevServer(canvasId: string): Promise<CanvasDevServerStatus> {
  const session = sessions.get(canvasId);
  if (session) {
    await closeSession(session);
  }

  return getCanvasDevServerStatus(canvasId);
}

export async function proxyCanvasDevServer(input: {
  canvasId: string;
  requestedPath: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}): Promise<Response> {
  const session = sessions.get(input.canvasId);
  if (!session) {
    throw new Error("Canvas dev server is not running");
  }

  touch(session);
  const targetPath = input.requestedPath.startsWith("/") ? input.requestedPath : `/${input.requestedPath}`;
  const targetUrl = `http://127.0.0.1:${session.hostPort}${targetPath}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(input.headers)) {
    if (!value || ["host", "connection", "content-length"].includes(key.toLowerCase())) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  return fetch(targetUrl, {
    method: input.method,
    headers,
    body: input.body as BodyInit | undefined,
    redirect: "manual"
  });
}

export async function cleanupCanvasDevServersOnce(): Promise<number> {
  const nowMs = Date.now();
  let closed = 0;
  for (const session of Array.from(sessions.values())) {
    if (nowMs - Date.parse(session.lastActiveAt) <= SESSION_IDLE_TIMEOUT_MS) {
      continue;
    }

    await closeSession(session);
    closed += 1;
  }

  return closed;
}

export function startCanvasDevServerCleanupLoop(): { stop: () => void } {
  const interval = setInterval(() => {
    void cleanupCanvasDevServersOnce().catch((error) => {
      console.error("[canvas] Failed to clean idle dev server sessions", error);
    });
  }, 5 * 60 * 1000);
  interval.unref();

  return {
    stop: () => clearInterval(interval)
  };
}
