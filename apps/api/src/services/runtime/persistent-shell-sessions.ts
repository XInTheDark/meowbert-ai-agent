import fs from "node:fs/promises";
import { requestPersistentShellRuntime, stripAnsi } from "@meowbert/shared";
import type { QueryResultRow } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import { apiSandboxManager } from "./sandbox.js";

const DEFAULT_OUTPUT_TAIL_LINES = 400;
const MAX_OUTPUT_TAIL_LINES = 2_000;

export type PersistentShellSessionStatus = "starting" | "running" | "idle" | "completed" | "stopped" | "failed";

export const DEFAULT_PERSISTENT_SHELL_LIFETIME_SECONDS = 43_200;

export interface PersistentShellSessionSummary {
  id: string;
  status: PersistentShellSessionStatus;
  command: string;
  workingDir: string;
  startedAt: string | null;
  updatedAt: string;
  output: string | null;
  mode: "terminal" | "pipe";
  commandId: string | null;
  exitCode: number | null;
  outputTruncated: boolean;
  lifetimeSeconds: number;
  expiresAt: string | null;
}

interface PersistentShellSessionRow extends QueryResultRow {
  id: string;
  status: PersistentShellSessionStatus;
  command: string;
  working_dir: string;
  log_path: string;
  container_id: string | null;
  mode: "terminal" | "pipe";
  command_id: string | null;
  command_exit_code: number | null;
  current_dir: string | null;
  output_truncated: boolean;
  started_at: Date | null;
  lifetime_seconds: number;
  expires_at: Date | null;
  updated_at: Date;
}

interface PersistentShellSessionTerminationRow extends QueryResultRow {
  id: string;
  container_id: string | null;
}

function tailLines(contents: string, lineLimit: number): string {
  const lines = contents.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.slice(-lineLimit).join("\n");
}

export async function listPersistentShellSessions(input: {
  environmentId?: string;
  taskId?: string;
  includeOutput?: boolean;
  outputTailLines?: number;
}): Promise<PersistentShellSessionSummary[]> {
  const outputTailLines = Math.min(
    MAX_OUTPUT_TAIL_LINES,
    Math.max(1, Math.floor(input.outputTailLines ?? DEFAULT_OUTPUT_TAIL_LINES))
  );
  const scopeId = input.taskId ?? input.environmentId;
  if (!scopeId) {
    throw new Error("Persistent shell session listing requires a project or task.");
  }
  const whereClause = input.taskId
    ? "created_by_task_id = $1"
    : "environment_id = $1 AND status IN ('starting', 'running', 'idle')";
  const result = await query<PersistentShellSessionRow>(
    `SELECT id, status, command, working_dir, log_path, container_id, mode, command_id, command_exit_code, current_dir, output_truncated, started_at, updated_at,
            lifetime_seconds, expires_at
       FROM persistent_shell_sessions
      WHERE ${whereClause}
      ORDER BY started_at ASC NULLS LAST, created_at ASC`,
    [scopeId]
  );

  return Promise.all(result.rows.map((session) => summarizeSession(session, input.includeOutput === true, outputTailLines)));
}

async function summarizeSession(session: PersistentShellSessionRow, includeOutput: boolean, tail: number): Promise<PersistentShellSessionSummary> {
  const runtime = session.container_id && ["starting", "running", "idle"].includes(session.status)
    ? await requestPersistentShellRuntime(apiSandboxManager, session, { action: "status" }).catch(() => null)
    : null;
  return {
    id: session.id,
    status: runtime?.status ?? session.status,
    command: runtime?.command ?? session.command,
    workingDir: runtime?.cwd ?? session.current_dir ?? session.working_dir,
    startedAt: session.started_at?.toISOString() ?? null,
    updatedAt: session.updated_at.toISOString(),
    mode: session.mode,
    commandId: runtime?.commandId ?? session.command_id,
    exitCode: runtime ? runtime.exitCode : session.command_exit_code,
    outputTruncated: runtime?.outputTruncated ?? session.output_truncated,
    lifetimeSeconds: session.lifetime_seconds ?? DEFAULT_PERSISTENT_SHELL_LIFETIME_SECONDS,
    expiresAt: session.expires_at ? (session.expires_at instanceof Date ? session.expires_at.toISOString() : String(session.expires_at)) : null,
    output: includeOutput
      ? tailLines(stripAnsi(await fs.readFile(session.log_path, "utf8").catch(() => "")), tail)
      : null
  };
}

export async function terminatePersistentShellSessions(input: {
  environmentId?: string;
  taskId?: string;
  sessionId?: string;
}): Promise<number> {
  const scopeId = input.taskId ?? input.environmentId;
  if (!scopeId) {
    throw new Error("Persistent shell termination requires a project or task.");
  }

  const scopeColumn = input.taskId ? "created_by_task_id" : "environment_id";
  const params: unknown[] = [scopeId];
  const sessionClause = input.sessionId ? " AND id = $2" : "";
  if (input.sessionId) params.push(input.sessionId);
  return withTransaction(async (client) => {
    const candidates = await client.query<{ id: string }>(
      `SELECT id FROM persistent_shell_sessions WHERE ${scopeColumn} = $1${sessionClause}
         AND status IN ('starting', 'running', 'idle') ORDER BY id`, params);
    if (candidates.rows.length === 0) return 0;
    for (const session of candidates.rows) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [session.id]);
    }
    const result = await client.query<PersistentShellSessionTerminationRow>(
      `SELECT id, container_id
         FROM persistent_shell_sessions
        WHERE ${scopeColumn} = $1${sessionClause}
          AND status IN ('starting', 'running', 'idle')
          AND id = ANY($${params.length + 1}::uuid[])
        FOR UPDATE`,
      [...params, candidates.rows.map((session) => session.id)]
    );
    if (result.rows.length === 0) return 0;

    await client.query(
      `UPDATE persistent_shell_sessions
          SET status = 'stopped', stopped_at = now(), stop_reason = $2,
              container_id = NULL, process_id = NULL, updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [result.rows.map((session) => session.id), "Terminated from the shell monitor."]
    );
    for (const session of result.rows) {
      if (session.container_id) await apiSandboxManager.stopAndRemoveContainer(session.container_id);
    }
    return result.rows.length;
  });
}
