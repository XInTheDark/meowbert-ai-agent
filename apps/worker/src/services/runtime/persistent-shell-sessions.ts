import { persistentShellLogPath, readPersistentShellOutput } from "./persistent-shell-output.js";
import { reserveCreditAndSlot, type CreditReservation } from "./persistent-shell-credits.js";
import { callPersistentShellRuntime, type PersistentShellRuntimeState } from "./persistent-shell-transport.js";
import { randomUUID } from "node:crypto";
import { formatSandboxCrashReport, type SandboxContainerLimits } from "@meowbert/shared/docker-sandbox";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { query, withConnection } from "../../lib/db.js";
import { resolveUserSandboxContainerResources } from "../agent-db/user-resource-limits.js";
import { resolveTaskReadableMountPaths } from "../agent/task-write-scope.js";
import { resolveTaskInputDir } from "../tasks/task-paths.js";
import { workerSandboxManager } from "./sandbox.js";

const STARTING_SESSION_TIMEOUT_MS = 5 * 60_000;
const CONTAINER_LOST_REASON = "Persistent runtime container exited before the command completed. Restart the command explicitly.";
export const DEFAULT_PERSISTENT_SHELL_LIFETIME_SECONDS = 43_200; // 12 hours
export const MAX_PERSISTENT_SHELL_LIFETIME_SECONDS = 1_209_600; // 14 days
export const MIN_PERSISTENT_SHELL_LIFETIME_SECONDS = 1;
export const EXPIRED_SESSION_STOP_REASON = "Persistent shell session lifetime expired.";
const sessionExpiryTimers = new Map<string, NodeJS.Timeout>();

type PersistentShellSessionStatus = "starting" | "running" | "idle" | "completed" | "stopped" | "failed";

interface PersistentShellSessionRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  creator_user_id: string;
  command: string;
  working_dir: string;
  env_root: string;
  workspace_root: string;
  network_enabled: boolean;
  run_as_root: boolean;
  container_id: string | null;
  process_id: number | null;
  log_path: string;
  status: PersistentShellSessionStatus;
  started_at: Date | null;
  last_charged_at: Date | null;
  completed_at: Date | null;
  stopped_at: Date | null;
  stop_reason: string | null;
  recovery_count: number;
  mode: "terminal" | "pipe";
  command_id: string | null;
  command_exit_code: number | null;
  current_dir: string | null;
  output_truncated: boolean;
  lifetime_seconds: number;
  expires_at: Date | null;
  updated_at: Date;
}

function dbQuery<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient | null,
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return client ? client.query<T>(text, params) : query<T>(text, params);
}

export interface PersistentShellContext {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  creatorUserId: string;
  taskDir: string;
  envRoot: string;
  workspaceRoot: string;
  workingDir: string;
  networkEnabled: boolean;
  runAsRoot: boolean;
  shell: string;
  env: Record<string, string>;
}

export type PersistentShellSandboxLimits = SandboxContainerLimits;

export interface PersistentShellSessionStatusResult {
  sessionId: string;
  status: PersistentShellSessionStatus;
  command: string;
  startedAt: string | null;
  completedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  output: string;
  outputFile: string | null;
  outputVersion: string | null;
  mode: "terminal" | "pipe";
  commandId: string | null;
  exitCode: number | null;
  cwd: string;
  outputTruncated: boolean;
  lifetimeSeconds: number;
  expiresAt: string | null;
}

export function normalizeLifetimeSeconds(lifetimeSeconds?: number | null): number {
  if (typeof lifetimeSeconds !== "number" || !Number.isFinite(lifetimeSeconds)) {
    return DEFAULT_PERSISTENT_SHELL_LIFETIME_SECONDS;
  }
  return Math.min(
    MAX_PERSISTENT_SHELL_LIFETIME_SECONDS,
    Math.max(MIN_PERSISTENT_SHELL_LIFETIME_SECONDS, Math.round(lifetimeSeconds))
  );
}

function isSessionExpired(session: { expires_at?: Date | string | null }): boolean {
  if (!session.expires_at) return false;
  const expiresAtMs = session.expires_at instanceof Date ? session.expires_at.getTime() : Date.parse(String(session.expires_at));
  return Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs;
}

function clearSessionExpiryTimer(sessionId: string): void {
  const timer = sessionExpiryTimers.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  sessionExpiryTimers.delete(sessionId);
}

function scheduleSessionExpiry(session: Pick<PersistentShellSessionRow, "id" | "environment_id" | "expires_at">): void {
  clearSessionExpiryTimer(session.id);
  if (!session.expires_at) return;

  const expiresAtMs = session.expires_at instanceof Date ? session.expires_at.getTime() : Date.parse(String(session.expires_at));
  const delayMs = Math.max(0, expiresAtMs - Date.now());
  const timer = setTimeout(() => {
    if (sessionExpiryTimers.get(session.id) !== timer) return;
    sessionExpiryTimers.delete(session.id);
    void withPersistentSessionLock(session.id, async (client) => {
      const latest = await loadSession(session.id, session.environment_id, client);
      if (!latest || !isActiveStatus(latest.status) || !isSessionExpired(latest)) return;
      await stopPersistentShellSessionUnlocked({
        sessionId: latest.id,
        environmentId: latest.environment_id,
        reason: EXPIRED_SESSION_STOP_REASON
      }, client);
    }).catch((error) => console.warn("[persistent-shell] session expiry failed", error));
  }, delayMs);
  timer.unref();
  sessionExpiryTimers.set(session.id, timer);
}

export function buildPersistentShellEnvironment(input: {
  taskDir: string;
  envRoot: string;
  workspaceRoot: string;
  workingDir: string;
  envOverrides?: Record<string, string>;
}): Record<string, string> {
  return {
    TASK_DIR: path.resolve(input.taskDir),
    ENV_ROOT: path.resolve(input.envRoot),
    TASK_INPUT_DIR: resolveTaskInputDir(input.taskDir),
    PWD: path.resolve(input.workingDir),
    HOME: path.resolve(input.envRoot),
    TERM: "xterm-256color",
    WORKSPACE_ROOT: path.resolve(input.workspaceRoot),
    MEOWBERT_WORKSPACE_ROOT: path.resolve(input.workspaceRoot),
    MEOWBERT_ENV_ROOT: path.resolve(input.envRoot),
    ...(input.envOverrides ?? {})
  };
}

function isActiveStatus(status: PersistentShellSessionStatus): boolean {
  return status === "starting" || status === "running" || status === "idle";
}

async function loadSession(sessionId: string, environmentId: string, client: PoolClient | null = null): Promise<PersistentShellSessionRow | null> {
  const result = await dbQuery<PersistentShellSessionRow>(client,
    `SELECT id, workspace_id, environment_id, creator_user_id, command, working_dir,
            env_root, workspace_root, network_enabled, run_as_root, container_id, process_id, log_path, status,
            started_at, last_charged_at, completed_at, stopped_at, stop_reason, recovery_count, updated_at, mode, command_id, command_exit_code, current_dir, output_truncated,
            lifetime_seconds, expires_at
       FROM persistent_shell_sessions
      WHERE id = $1 AND environment_id = $2`,
    [sessionId, environmentId]
  );
  return result.rows[0] ?? null;
}

async function withPersistentSessionLock<T>(sessionId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  return withConnection(async (client) => {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [sessionId]);
    try {
      return await callback(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [sessionId]).catch(() => {});
    }
  });
}

async function launchSessionCommand(
  session: PersistentShellSessionRow,
  context: PersistentShellContext,
  client: PoolClient | null = null
): Promise<PersistentShellSandboxLimits> {
  const logPath = persistentShellLogPath(session.env_root, session.id);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const mounts = (await resolveTaskReadableMountPaths({
    envRoot: session.env_root,
    workspaceRoot: session.workspace_root
  })).map((mountPath) => ({ path: mountPath }));
  const resources = await resolveUserSandboxContainerResources(session.creator_user_id);
  const sandbox = await workerSandboxManager.createPersistentSandbox({
    workingDir: session.working_dir,
    networkEnabled: context.networkEnabled,
    mounts,
    runAsRoot: context.runAsRoot,
    env: context.env,
    labels: {
      workspaceId: session.workspace_id,
      environmentId: session.environment_id,
      sessionId: session.id,
      purpose: "shell-session"
    },
    resources
  });

  try {
    const target = { ...session, container_id: sandbox.id };
    await callPersistentShellRuntime(target, {
      mode: session.mode, cwd: session.working_dir, logPath: logPath
    }, "launch");
    const runtime = session.command
      ? await callPersistentShellRuntime(target, { action: "submit", command: session.command })
      : await callPersistentShellRuntime(target, { action: "status" });
    const updated = await dbQuery(
      client,
      `UPDATE persistent_shell_sessions
          SET container_id = $2, process_id = NULL, status = $3, started_at = now(),
              command_id = $4, current_dir = $5,
              completed_at = NULL, stopped_at = NULL, stop_reason = NULL, updated_at = now()
        WHERE id = $1 AND status = 'starting'`,
      [session.id, sandbox.id, runtime.status, runtime.commandId, runtime.cwd]
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw new Error("Persistent shell session was terminated before its command started.");
    }
    return { memoryMb: resources.memoryMb ?? null, cpus: resources.cpus ?? null, pids: resources.pids ?? null };
  } catch (error) {
    await sandbox.stop().catch(() => {});
    throw error;
  }
}

async function stopContainer(session: PersistentShellSessionRow): Promise<void> {
  if (session.container_id) {
    await workerSandboxManager.stopAndRemoveContainer(session.container_id);
  }
}

function assertProjectContext(session: PersistentShellSessionRow, context: PersistentShellContext): void {
  if (session.workspace_id !== context.workspaceId || session.environment_id !== context.environmentId) {
    throw new Error("Persistent shell session does not belong to this project.");
  }
}

export async function startPersistentShellSession(
  input: PersistentShellContext & {
    command?: string | null;
    mode?: "terminal" | "pipe" | null;
    lifetimeSeconds?: number | null;
  }
): Promise<{ sessionId: string; lifetimeSeconds: number; expiresAt: string; limits: PersistentShellSandboxLimits }> {
  const sessionId = randomUUID();
  const logPath = persistentShellLogPath(input.envRoot, sessionId);
  const lifetimeSeconds = normalizeLifetimeSeconds(input.lifetimeSeconds);
  const expiresAt = new Date(Date.now() + lifetimeSeconds * 1000);

  await query(
    `INSERT INTO persistent_shell_sessions (
       id, workspace_id, environment_id, creator_user_id, created_by_task_id, command, working_dir,
       env_root, workspace_root, network_enabled, run_as_root, log_path, status, mode, lifetime_seconds, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'starting', $13, $14, $15)`,
    [sessionId, input.workspaceId, input.environmentId, input.creatorUserId, input.taskId, input.command ?? "",
      input.workingDir, input.envRoot, input.workspaceRoot, input.networkEnabled, input.runAsRoot, logPath, input.mode ?? "terminal",
      lifetimeSeconds, expiresAt]
  );
  scheduleSessionExpiry({ id: sessionId, environment_id: input.environmentId, expires_at: expiresAt });
  return withPersistentSessionLock(sessionId, async (client) => {
    let reservation: CreditReservation | null = null;
    try {
      const pending = await loadSession(sessionId, input.environmentId, client);
      if (!pending || pending.status !== "starting") throw new Error("Session was stopped before startup.");
      reservation = await reserveCreditAndSlot({ userId: input.creatorUserId, sessionId, newSession: true }, client);
      const session = await loadSession(sessionId, input.environmentId, client);
      if (!session) throw new Error("Persistent shell session was not created.");
      const limits = await launchSessionCommand(session, input, client);
      return { sessionId, lifetimeSeconds, expiresAt: expiresAt.toISOString(), limits };
    } catch (error) {
      if (reservation?.eventId) {
        await dbQuery(client, `DELETE FROM user_persistent_runtime_compute_events WHERE id = $1`, [reservation.eventId]).catch(() => {});
      }
      await dbQuery(client,
        `UPDATE persistent_shell_sessions SET status = 'failed', stopped_at = now(), stop_reason = $2, updated_at = now() WHERE id = $1 AND status = 'starting'`,
        [sessionId, error instanceof Error ? error.message : String(error)]
      ).catch(() => {});
      clearSessionExpiryTimer(sessionId);
      throw error;
    }
  });
}

async function persistRuntimeState(session: PersistentShellSessionRow, runtime: PersistentShellRuntimeState, client: PoolClient | null): Promise<void> {
  await dbQuery(client,
    `UPDATE persistent_shell_sessions SET status = $2, command = $3, command_id = $4,
       command_exit_code = $5, current_dir = $6, output_truncated = $7,
       completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
       updated_at = now() WHERE id = $1 AND status IN ('starting', 'running', 'idle')`,
    [session.id, runtime.status, runtime.command, runtime.commandId, runtime.exitCode, runtime.cwd, runtime.outputTruncated]);
}

export async function runPersistentShellCommand(input: PersistentShellContext & {
  sessionId: string;
  command: string;
  force: boolean;
}): Promise<{ sessionId: string; status: string; commandId: string | null }> {
  return withPersistentSessionLock(input.sessionId, async (client) => {
    const session = await loadSession(input.sessionId, input.environmentId, client);
    if (!session) throw new Error(`Persistent shell session not found: ${input.sessionId}`);
    assertProjectContext(session, input);
    if (isSessionExpired(session)) {
      await stopPersistentShellSessionUnlocked({
        sessionId: session.id,
        environmentId: session.environment_id,
        reason: EXPIRED_SESSION_STOP_REASON
      }, client);
      throw new Error("Persistent shell session lifetime expired. Start a new shell_session.");
    }
    if (!isActiveStatus(session.status)) throw new Error("This session has ended. Start a new shell_session.");
    let runtime = await callPersistentShellRuntime(session, { action: "status" });
    if (runtime.status === "running" && input.force) {
      await callPersistentShellRuntime(session, { action: "interrupt", commandId: runtime.commandId });
      const deadline = Date.now() + 5_000;
      while (runtime.status === "running" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        runtime = await callPersistentShellRuntime(session, { action: "status" });
      }
    }
    if (runtime.status !== "idle") {
      await persistRuntimeState(session, runtime, client);
      throw new Error("Session is not idle. Inspect it, send input or interrupt, or start another shell_session.");
    }
    runtime = await callPersistentShellRuntime(session, { action: "submit", command: input.command });
    await persistRuntimeState(session, runtime, client);
    return { sessionId: session.id, status: runtime.status, commandId: runtime.commandId };
  });
}

export async function controlPersistentShellSession(input: {
  sessionId: string;
  environmentId: string;
  action: "input" | "interrupt" | "eof" | "resize";
  data?: string | null;
  cols?: number | null;
  rows?: number | null;
}): Promise<Record<string, unknown>> {
  return withPersistentSessionLock(input.sessionId, async (client) => {
    const session = await loadSession(input.sessionId, input.environmentId, client);
    if (!session || !isActiveStatus(session.status)) throw new Error("Persistent shell session is unavailable.");
    if (isSessionExpired(session)) {
      await stopPersistentShellSessionUnlocked({
        sessionId: session.id,
        environmentId: session.environment_id,
        reason: EXPIRED_SESSION_STOP_REASON
      }, client);
      throw new Error("Persistent shell session is unavailable.");
    }
    const runtime = await callPersistentShellRuntime(session, { action: "status" });
    const result = await callPersistentShellRuntime<Record<string, unknown>>(session, {
      action: input.action, commandId: runtime.commandId, data: input.data, cols: input.cols, rows: input.rows
    });
    try {
      await persistRuntimeState(session, await callPersistentShellRuntime(session, { action: "status" }), client);
    } catch {
      // Preserve the delivery acknowledgement even if metadata synchronization fails.
      return { ...result, statusSyncPending: true };
    }
    return result;
  });
}

async function getPersistentShellSessionStatusUnlocked(input: {
  sessionId: string;
  environmentId: string;
  taskDir: string;
  tailLines?: number | null;
  saveOutputPath?: string | null;
}, client: PoolClient | null = null): Promise<PersistentShellSessionStatusResult> {
  let session = await loadSession(input.sessionId, input.environmentId, client);
  if (!session) throw new Error(`Persistent shell session not found: ${input.sessionId}`);
  await refreshSessionState(session, client);
  session = await loadSession(input.sessionId, input.environmentId, client);
  if (!session) throw new Error(`Persistent shell session not found: ${input.sessionId}`);
  const { output, outputFile, outputVersion } = await readPersistentShellOutput({ ...input, logPath: session.log_path });
  return {
    sessionId: session.id,
    status: session.status,
    command: session.command,
    startedAt: session.started_at?.toISOString() ?? null,
    completedAt: session.completed_at?.toISOString() ?? null,
    stoppedAt: session.stopped_at?.toISOString() ?? null,
    stopReason: session.stop_reason,
    output,
    outputFile,
    outputVersion,
    mode: session.mode, commandId: session.command_id, exitCode: session.command_exit_code,
    cwd: session.current_dir ?? session.working_dir, outputTruncated: session.output_truncated,
    lifetimeSeconds: session.lifetime_seconds ?? DEFAULT_PERSISTENT_SHELL_LIFETIME_SECONDS,
    expiresAt: session.expires_at ? (session.expires_at instanceof Date ? session.expires_at.toISOString() : String(session.expires_at)) : null
  };
}

export async function getPersistentShellSessionStatus(input: {
  sessionId: string;
  environmentId: string;
  taskDir: string;
  tailLines?: number | null;
  saveOutputPath?: string | null;
}): Promise<PersistentShellSessionStatusResult> {
  return withPersistentSessionLock(input.sessionId, (client) => getPersistentShellSessionStatusUnlocked(input, client));
}

async function stopPersistentShellSessionUnlocked(input: {
  sessionId: string;
  environmentId: string;
  reason?: string;
}, client: PoolClient | null = null): Promise<void> {
  const session = await loadSession(input.sessionId, input.environmentId, client);
  if (!session) throw new Error(`Persistent shell session not found: ${input.sessionId}`);
  await stopContainer(session);
  await dbQuery(
    client,
    `UPDATE persistent_shell_sessions
        SET status = 'stopped', stopped_at = now(), stop_reason = $2, container_id = NULL, process_id = NULL, updated_at = now()
      WHERE id = $1`,
    [session.id, input.reason ?? "Stopped by shell_session."]
  );
  clearSessionExpiryTimer(session.id);
}

export async function stopPersistentShellSession(input: {
  sessionId: string;
  environmentId: string;
  reason?: string;
}): Promise<void> {
  return withPersistentSessionLock(input.sessionId, (client) => stopPersistentShellSessionUnlocked(input, client));
}

export interface PersistentShellSessionListItem {
  id: string;
  status: PersistentShellSessionStatus;
  command: string;
  workingDir: string;
  startedAt: string | null;
  updatedAt: string;
  mode: "terminal" | "pipe";
  commandId: string | null;
  exitCode: number | null;
  outputTruncated: boolean;
  lifetimeSeconds: number;
  expiresAt: string | null;
}

export async function listPersistentShellSessions(input: {
  environmentId: string;
}): Promise<PersistentShellSessionListItem[]> {
  const result = await query<PersistentShellSessionRow>(
    `SELECT id, workspace_id, environment_id, creator_user_id, command, working_dir,
            env_root, workspace_root, network_enabled, run_as_root, container_id, process_id, log_path, status,
            started_at, last_charged_at, completed_at, stopped_at, stop_reason, recovery_count, updated_at, mode, command_id, command_exit_code, current_dir, output_truncated,
            lifetime_seconds, expires_at
       FROM persistent_shell_sessions
      WHERE environment_id = $1 AND status IN ('starting', 'running', 'idle')
      ORDER BY started_at ASC NULLS LAST, created_at ASC`,
    [input.environmentId]
  );
  const items: PersistentShellSessionListItem[] = [];
  for (const row of result.rows) {
    const session = await withPersistentSessionLock(row.id, async (client) => {
      const latest = await loadSession(row.id, row.environment_id, client);
      if (!latest) return null;
      await refreshSessionState(latest, client);
      return (await loadSession(row.id, row.environment_id, client)) ?? latest;
    }).catch(() => row);

    if (session) {
      items.push({
        id: session.id,
        status: session.status,
        command: session.command,
        workingDir: session.current_dir ?? session.working_dir,
        startedAt: session.started_at ? (session.started_at instanceof Date ? session.started_at.toISOString() : String(session.started_at)) : null,
        updatedAt: session.updated_at ? (session.updated_at instanceof Date ? session.updated_at.toISOString() : String(session.updated_at)) : new Date().toISOString(),
        mode: session.mode,
        commandId: session.command_id,
        exitCode: session.command_exit_code,
        outputTruncated: session.output_truncated,
        lifetimeSeconds: session.lifetime_seconds ?? DEFAULT_PERSISTENT_SHELL_LIFETIME_SECONDS,
        expiresAt: session.expires_at ? (session.expires_at instanceof Date ? session.expires_at.toISOString() : String(session.expires_at)) : null
      });
    }
  }
  return items;
}

async function refreshSessionState(session: PersistentShellSessionRow, client: PoolClient | null = null): Promise<void> {
  if (!isActiveStatus(session.status)) return;
  if (isSessionExpired(session)) {
    clearSessionExpiryTimer(session.id);
    await stopContainer(session).catch(() => {});
    await dbQuery(client,
      `UPDATE persistent_shell_sessions
          SET container_id = NULL, process_id = NULL, status = 'stopped',
              stopped_at = now(), stop_reason = $2, updated_at = now()
        WHERE id = $1 AND status IN ('starting', 'running', 'idle')`,
      [session.id, EXPIRED_SESSION_STOP_REASON]);
    return;
  }
  if (!session.container_id) {
    if (session.status === "starting" && Date.now() - session.updated_at.getTime() >= STARTING_SESSION_TIMEOUT_MS) {
      clearSessionExpiryTimer(session.id);
      await dbQuery(
        client,
        `UPDATE persistent_shell_sessions
            SET status = 'failed', stopped_at = now(), stop_reason = $2, updated_at = now()
          WHERE id = $1 AND status = 'starting' AND container_id IS NULL`,
        [session.id, "Persistent runtime command did not start. Restart the command explicitly."]
      );
    }
    return;
  }
  try {
    const runtime = await callPersistentShellRuntime(session, { action: "status" });
    await persistRuntimeState(session, runtime, client);
    if (!isActiveStatus(runtime.status)) {
      clearSessionExpiryTimer(session.id);
    }
    if (runtime.status === "completed") {
      await stopContainer(session);
      await dbQuery(client, "UPDATE persistent_shell_sessions SET container_id = NULL, process_id = NULL WHERE id = $1", [session.id]);
    }
  } catch {
    clearSessionExpiryTimer(session.id);
    const crashReport = await workerSandboxManager.readCrashReport(session.container_id).catch(() => null);
    await stopContainer(session).catch(() => {});
    await dbQuery(client,
      `UPDATE persistent_shell_sessions SET container_id = NULL, process_id = NULL, status = 'failed',
         stopped_at = now(), stop_reason = $2, recovery_count = recovery_count + 1, updated_at = now()
       WHERE id = $1 AND status IN ('starting', 'running', 'idle')`,
      [session.id, crashReport ? `${CONTAINER_LOST_REASON}\n${formatSandboxCrashReport(crashReport)}` : CONTAINER_LOST_REASON]);
  }
}

export async function restorePersistentShellExpiryTimers(): Promise<void> {
  const result = await query<{ id: string; environment_id: string; expires_at: Date | null }>(
    `SELECT id, environment_id, expires_at
       FROM persistent_shell_sessions
      WHERE status IN ('starting', 'running', 'idle')`
  );
  for (const session of result.rows) {
    scheduleSessionExpiry(session);
  }
}

export const persistentShellTestUtils = {
  buildPersistentShellEnvironment,
  normalizeLifetimeSeconds,
  DEFAULT_PERSISTENT_SHELL_LIFETIME_SECONDS,
  MAX_PERSISTENT_SHELL_LIFETIME_SECONDS,
  MIN_PERSISTENT_SHELL_LIFETIME_SECONDS,
  EXPIRED_SESSION_STOP_REASON
};
