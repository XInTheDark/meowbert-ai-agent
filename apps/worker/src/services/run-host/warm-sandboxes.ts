import type { DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";
import { query } from "../../lib/db.js";

// Task sandboxes kept running between runs (the task's warm sandbox harness setting). Only this
// process holds a parked sandbox's handle, so only a run of the same task in this process reuses
// it. The task_warm_sandboxes row keeps orphan cleanup in every process from removing it early,
// both while it is parked and while the run that adopted it is still going.

// How the sandbox was made. A run reuses a warm sandbox only when all of these match, so it never
// gets another user's source mounts.
export interface WarmSandboxFingerprint {
  actorUserId: string | null;
  networkEnabled: boolean;
  runAsRoot: boolean;
  readOnly: boolean;
}

interface ParkedSandbox {
  taskId: string;
  sandbox: DockerSandboxHandle;
  fingerprint: WarmSandboxFingerprint;
  parkedAtMs: number;
  expiresAtMs: number;
  timer: NodeJS.Timeout;
  release: () => Promise<void>;
}

const parked = new Map<string, ParkedSandbox>();

async function deleteRow(containerId: string): Promise<void> {
  await query("DELETE FROM task_warm_sandboxes WHERE container_id = $1", [containerId]).catch(() => undefined);
}

async function stopParked(entry: ParkedSandbox): Promise<void> {
  clearTimeout(entry.timer);
  if (parked.get(entry.taskId) === entry) parked.delete(entry.taskId);
  await entry.sandbox.stop().catch(() => undefined);
  await entry.release().catch(() => undefined);
  await deleteRow(entry.sandbox.id);
}

function sameFingerprint(left: WarmSandboxFingerprint, right: WarmSandboxFingerprint): boolean {
  return left.actorUserId === right.actorUserId
    && left.networkEnabled === right.networkEnabled
    && left.runAsRoot === right.runAsRoot
    && left.readOnly === right.readOnly;
}

// The warm minutes the task has now, read when its run ends so a change made during the run counts.
export async function loadSandboxKeepWarmMinutes(taskId: string): Promise<number | null> {
  const result = await query<{ sandbox_keep_warm_minutes: number | null }>(
    "SELECT sandbox_keep_warm_minutes FROM task_harness_settings WHERE task_id = $1",
    [taskId]
  );
  return result.rows[0]?.sandbox_keep_warm_minutes ?? null;
}

// Parked warm sandboxes count against the same per-user limit as persistent shell sessions.
async function hasRuntimeSlot(userId: string | null, limit: number | null): Promise<boolean> {
  if (!userId || limit === null) return true;
  const result = await query<{ count: string }>(
    `SELECT ((SELECT COUNT(*) FROM persistent_shell_sessions
               WHERE creator_user_id = $1 AND status IN ('starting', 'running', 'idle'))
           + (SELECT COUNT(*) FROM task_warm_sandboxes
               WHERE user_id = $1 AND adopted_by_run_id IS NULL AND expires_at > now()))::text AS count`,
    [userId]
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10) < limit;
}

export async function parkWarmSandbox(input: {
  taskId: string;
  userId: string | null;
  runtimeLimit: number | null;
  sandbox: DockerSandboxHandle;
  fingerprint: WarmSandboxFingerprint;
  minutes: number;
  release: () => Promise<void>;
}): Promise<boolean> {
  const previous = parked.get(input.taskId);
  if (previous && previous.sandbox !== input.sandbox) await stopParked(previous);
  if (!(await hasRuntimeSlot(input.userId, input.runtimeLimit))) return false;
  const expiresAtMs = Date.now() + input.minutes * 60_000;
  await query(
    `INSERT INTO task_warm_sandboxes (container_id, task_id, user_id, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (container_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, adopted_by_run_id = NULL`,
    [input.sandbox.id, input.taskId, input.userId, new Date(expiresAtMs).toISOString()]
  );
  const entry: ParkedSandbox = {
    taskId: input.taskId,
    sandbox: input.sandbox,
    fingerprint: input.fingerprint,
    parkedAtMs: Date.now(),
    expiresAtMs,
    release: input.release,
    timer: setTimeout(() => void stopParked(entry), input.minutes * 60_000)
  };
  entry.timer.unref?.();
  parked.set(input.taskId, entry);
  return true;
}

// A crash report, or a failed read of one, means the container can't be trusted.
async function isHealthy(sandbox: DockerSandboxHandle): Promise<boolean> {
  try {
    return (await sandbox.readCrashReport()) === null;
  } catch {
    return false;
  }
}

// Hands the task's parked sandbox to a new run when it is still running and was made the same way.
// The adopted sandbox takes over the parked one's source mount reference, which the new run
// releases when it stops.
export async function adoptWarmSandbox(input: {
  taskId: string;
  runId: string;
  fingerprint: WarmSandboxFingerprint;
}): Promise<DockerSandboxHandle | null> {
  const entry = parked.get(input.taskId);
  if (!entry) return null;
  parked.delete(input.taskId);
  clearTimeout(entry.timer);
  const usable = Date.now() < entry.expiresAtMs
    && sameFingerprint(entry.fingerprint, input.fingerprint)
    && (await isHealthy(entry.sandbox));
  if (!usable) {
    await entry.sandbox.stop().catch(() => undefined);
    await entry.release().catch(() => undefined);
    await deleteRow(entry.sandbox.id);
    return null;
  }
  const marked = await query(
    "UPDATE task_warm_sandboxes SET adopted_by_run_id = $2 WHERE container_id = $1",
    [entry.sandbox.id, input.runId]
  ).catch(() => null);
  if (!marked?.rowCount) {
    // Without the row, orphan cleanup would remove the container under the new run.
    await entry.sandbox.stop().catch(() => undefined);
    await entry.release().catch(() => undefined);
    return null;
  }
  return entry.sandbox;
}

// Frees a slot for a new sandbox by stopping the oldest parked one.
export async function evictOldestWarmSandbox(): Promise<boolean> {
  const oldest = [...parked.values()].sort((left, right) => left.parkedAtMs - right.parkedAtMs)[0];
  if (!oldest) return false;
  await stopParked(oldest);
  return true;
}

export async function stopAllWarmSandboxes(): Promise<void> {
  await Promise.all([...parked.values()].map((entry) => stopParked(entry)));
}

// Drops warm rows that no longer apply, stops this process's parked sandboxes whose row is gone,
// and returns the containers orphan cleanup must leave alone. A parked row goes when it expires,
// its task is cancelled or trashed (those paths run in the API), or the setting is cleared. An
// adopted row goes when the run that adopted it has ended.
export async function listWarmSandboxContainerIds(): Promise<Set<string>> {
  await query(
    `DELETE FROM task_warm_sandboxes w
      USING tasks t
      LEFT JOIN task_harness_settings h ON h.task_id = t.id
      WHERE w.task_id = t.id
        AND CASE
              WHEN w.adopted_by_run_id IS NOT NULL THEN NOT EXISTS (
                SELECT 1 FROM task_runs r WHERE r.id = w.adopted_by_run_id AND r.ended_at IS NULL
              )
              ELSE w.expires_at <= now() OR t.trashed_at IS NOT NULL OR t.status = 'cancelled'
                OR h.sandbox_keep_warm_minutes IS NULL
            END`
  );
  const result = await query<{ container_id: string }>("SELECT container_id FROM task_warm_sandboxes");
  const kept = new Set(result.rows.map((row) => row.container_id));
  const dropped = [...parked.values()].filter((entry) => !kept.has(entry.sandbox.id));
  await Promise.all(dropped.map((entry) => stopParked(entry)));
  return kept;
}
