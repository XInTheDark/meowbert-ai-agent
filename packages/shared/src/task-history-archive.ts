import { restoreTaskArchiveRecords } from "./task-history-archive-batches.js";
import { materializeWarmTaskPayloads } from "./task-history-warm-payloads.js";
import { readTaskExecutionArchive, clearRestoredArchiveReferences } from "./task-history-execution-restore.js";
import { conversationSnapshotArchiveSchema, loadConversationSnapshotArchive, stubConversationSnapshotArchive, restoreConversationSnapshotArchive, type ConversationSnapshotArchive } from "./conversation-organization-archive.js";
import { loadTaskSubagentArchive, stubTaskSubagentArchive, restoreTaskSubagentArchive, taskSubagentArchiveSchema, type TaskSubagentArchive } from "./task-subagent-archive.js";
import { loadTaskSwarmArchive, stubTaskSwarmArchive, restoreTaskSwarmArchive, taskSwarmArchiveSchema, type TaskSwarmArchive } from "./task-swarm-archive.js";
import { loadTaskMediaArchive, stubTaskMediaArchive, restoreTaskMediaArchive, taskMediaArchiveSchema, type TaskMediaArchive } from "./task-media-archive.js";
import { loadTaskContextArchive, stubTaskContextArchive, restoreTaskContextArchive, type TaskContextArchive } from "./task-context-archive.js";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readTaskArchive, writeTaskArchive } from "./task-history-archive-format.js";
import { taskArchivePath } from "./task-history-archive-files.js";
import { publishTaskArchiveReferences, readTaskHistoryPayloads, type TaskHistoryPayloadReader } from "./task-history-payload-reader.js";
import type { TaskArchiveReference } from "./task-history-archive-sections.js";
import { z } from "zod";
import { parseInlineArtifact, serializeInlineArtifact } from "./inline-artifacts.js";

const execFile = promisify(execFileCallback);
const MOUNTPOINT_COMMAND = "mountpoint";
const MOUNTPOINT_TIMEOUT_MS = 5_000;
const ARCHIVE_STALE_AFTER_MS = 10 * 60 * 1000;

export const TASK_HISTORY_ARCHIVE_VERSION = 2;
export const TASK_HISTORY_ARCHIVE_STATE_VALUES = ["warm", "archiving", "archived"] as const;
export type TaskHistoryArchiveState = (typeof TASK_HISTORY_ARCHIVE_STATE_VALUES)[number];

export const taskHistoryArchiveConfigInputSchema = z.object({
  mountPath: z.string().trim().min(1).optional(),
  archivesDir: z.string().trim().min(1).max(240).optional()
}).optional();

export type RawTaskHistoryArchiveConfig = z.infer<typeof taskHistoryArchiveConfigInputSchema>;

export interface NormalizedTaskHistoryArchiveConfig {
  enabled: boolean;
  mountPath: string | null;
  archivesDir: string;
  rootPath: string | null;
}

export interface TaskHistoryArchiveLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface TaskHistoryArchiveHealth {
  enabled: boolean;
  mountPath: string | null;
  rootPath: string | null;
  mounted: boolean;
  state: "ready" | "error" | "disabled";
  message: string | null;
}

interface TaskHistoryArchiveHealthDeps {
  stat?: (targetPath: string) => Promise<{ isDirectory: () => boolean }>;
  isMounted?: (mountPath: string) => Promise<boolean>;
  mkdir?: (targetPath: string, options: { recursive: true }) => Promise<string | undefined>;
  writeFile?: (targetPath: string, data: string) => Promise<void>;
  unlink?: (targetPath: string) => Promise<void>;
}

export interface TaskHistoryArchiveMessageEntry {
  id: string;
  content_json: Record<string, unknown>;
  token_usage_json: Record<string, unknown> | null;
}

export interface TaskHistoryArchiveEventEntry {
  id: string;
  payload_json: Record<string, unknown>;
}

export interface TaskHistoryArchiveRevisionEntry {
  id: string;
  old_content_json: Record<string, unknown>;
  new_content_json: Record<string, unknown>;
}

export interface TaskHistoryArchiveDocument {
  conversation_snapshots?: ConversationSnapshotArchive;
  context?: TaskContextArchive;
  subagents?: TaskSubagentArchive;
  swarm?: TaskSwarmArchive;
  media?: TaskMediaArchive;
  version: number;
  task: {
    id: string;
    workspace_id: string;
    environment_id: string;
    archived_at: string;
    last_active_at: string;
  };
  messages: TaskHistoryArchiveMessageEntry[];
  events: TaskHistoryArchiveEventEntry[];
  message_revisions: TaskHistoryArchiveRevisionEntry[];
}

interface TaskArchiveSnapshotRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  status: string;
  schedule_state: "active" | "paused" | "cancelled" | null;
  has_pending_work?: boolean;
  task_history_state: TaskHistoryArchiveState;
  task_history_archive_key: string | null;
  task_history_archive_failed_attempts: number;
  task_history_last_active_at: string | Date;
  task_history_last_warmed_at: string | Date | null;
}

interface TaskArchivePayloadMessageRow {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content_json: Record<string, unknown>;
  token_usage_json: Record<string, unknown> | null;
}

interface TaskArchivePayloadEventRow {
  id: string;
  payload_json: Record<string, unknown>;
}

interface TaskArchivePayloadRevisionRow {
  id: string;
  old_content_json: Record<string, unknown>;
  new_content_json: Record<string, unknown>;
}

function normalizeArchiveTimestamp(value: string | Date): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid task-history timestamp: ${String(value)}`);
  }
  return timestamp.toISOString();
}

function normalizeOptionalArchiveTimestamp(value: string | Date | null): string | null {
  return value === null ? null : normalizeArchiveTimestamp(value);
}

interface QueryResultLike<T> {
  rows: T[];
  rowCount: number | null;
}

export interface TaskHistoryArchiveQueryable {
  readPayloads?: TaskHistoryPayloadReader;
  query<T extends object>(text: string, params?: unknown[]): Promise<QueryResultLike<T>>;
}

export type TaskHistoryArchiveTransactionRunner = <T>(
  fn: (client: TaskHistoryArchiveQueryable) => Promise<T>
) => Promise<T>;

export interface TaskHistoryArchiveDbAccess {
  query: TaskHistoryArchiveQueryable["query"];
  withTransaction: TaskHistoryArchiveTransactionRunner;
}

export interface TaskHistoryArchiveDeps {
  archiveConfig: NormalizedTaskHistoryArchiveConfig;
  db: TaskHistoryArchiveDbAccess;
  logger?: TaskHistoryArchiveLogger;
  now?: () => Date;
}

export interface ArchiveTaskHistoryResult {
  status: "archived" | "skipped" | "not_found";
  archiveKey?: string;
  metrics?: TaskHistoryArchiveMetrics;
  reason?: string;
}

export interface TaskHistoryArchiveMetrics {
  originalSizeBytes: number;
  compressedSizeBytes: number;
  messageCount: number;
  eventCount: number;
  revisionCount: number;
}

export interface EnsureTaskHistoryWarmResult {
  status: "warm" | "restored" | "not_found";
}

const taskHistoryArchiveDocumentSchema = z.object({
  conversation_snapshots: conversationSnapshotArchiveSchema.optional(),
  subagents: taskSubagentArchiveSchema.optional(),
  swarm: taskSwarmArchiveSchema.optional(),
  media: taskMediaArchiveSchema.optional(),
  context: z.object({
    windowPrompts: z.array(z.object({ id: z.string().uuid(), opening_prompt_json: z.array(z.unknown()) })).optional(),
    windowRequests: z.array(z.object({ id: z.string().uuid(), request_state_json: z.record(z.string(), z.unknown()) })).optional(),
    history: z.array(z.object({ id: z.string().uuid(), payload_json: z.record(z.string(), z.unknown()) })),
    notes: z.array(z.object({ id: z.string().uuid(), content: z.string() }))
  }).optional(),
  version: z.number().int().positive(),
  task: z.object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    environment_id: z.string().uuid(),
    archived_at: z.string().datetime(),
    last_active_at: z.string().datetime()
  }),
  messages: z.array(z.object({
    id: z.string().uuid(),
    content_json: z.record(z.string(), z.unknown()),
    token_usage_json: z.record(z.string(), z.unknown()).nullable()
  })),
  events: z.array(z.object({
    id: z.string().uuid(),
    payload_json: z.record(z.string(), z.unknown())
  })),
  message_revisions: z.array(z.object({
    id: z.string().uuid(),
    old_content_json: z.record(z.string(), z.unknown()),
    new_content_json: z.record(z.string(), z.unknown())
  }))
  // Archives written before Agent Swarm lanes may carry workflow_messages; parsing drops that section.
});

function resolvePathFromRoot(root: string, maybeRelative: string): string {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(root, maybeRelative);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isMountedError(code: string | undefined): boolean {
  return code === "ENOENT" || code === "ENOTDIR";
}

function extractInlineArtifact(content: Record<string, unknown>): Record<string, unknown> | null {
  const directArtifact = parseInlineArtifact(content.inline_artifact);
  if (directArtifact) {
    return serializeInlineArtifact(directArtifact);
  }

  const functionOutput = asRecord(content.response_function_output)?.output;
  const functionArtifact = parseInlineArtifact(functionOutput);
  if (functionArtifact) {
    return serializeInlineArtifact(functionArtifact);
  }

  const customOutput = asRecord(content.response_custom_tool_output)?.output;
  const customArtifact = parseInlineArtifact(customOutput);
  return customArtifact ? serializeInlineArtifact(customArtifact) : null;
}

function formatArchiveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 1_000 ? `${message.slice(0, 997)}...` : message;
}

async function isMounted(mountPath: string): Promise<boolean> {
  try {
    await execFile(MOUNTPOINT_COMMAND, ["-q", mountPath], {
      timeout: MOUNTPOINT_TIMEOUT_MS
    });
    return true;
  } catch {
    return false;
  }
}

async function checkArchiveRootWritable(
  archiveConfig: NormalizedTaskHistoryArchiveConfig,
  deps: TaskHistoryArchiveHealthDeps
): Promise<string | null> {
  if (!archiveConfig.rootPath) {
    return "Task history archive root path is not configured.";
  }

  const mkdir = deps.mkdir ?? fsPromises.mkdir;
  const writeFile = deps.writeFile ?? fsPromises.writeFile;
  const unlink = deps.unlink ?? fsPromises.unlink;
  const probePath = path.join(
    archiveConfig.rootPath,
    `.meowbert-archive-health-${process.pid}-${Date.now()}.tmp`
  );

  try {
    await mkdir(archiveConfig.rootPath, { recursive: true });
    await writeFile(probePath, "ok");
    await unlink(probePath).catch(() => undefined);
    return null;
  } catch (error) {
    await unlink(probePath).catch(() => undefined);
    return `Archive root is not writable at ${archiveConfig.rootPath}: ${formatArchiveError(error)}`;
  }
}

export function buildTaskArchiveStub(role: TaskArchivePayloadMessageRow["role"], content: Record<string, unknown>): Record<string, unknown> {
  if (role !== "tool") {
    return { text: "" };
  }

  const stub: Record<string, unknown> = {};
  const toolName = asTrimmedString(content.tool);
  const durationMs = asFiniteNumber(content.durationMs);
  const inlineArtifact = extractInlineArtifact(content);

  if (toolName) {
    stub.tool = toolName;
  }
  if (durationMs !== null) {
    stub.durationMs = durationMs;
  }
  if (inlineArtifact) {
    stub.inline_artifact = inlineArtifact;
  }

  return stub;
}

async function loadTaskArchiveSnapshot(
  client: TaskHistoryArchiveQueryable,
  taskId: string
): Promise<TaskArchiveSnapshotRow | null> {
  const result = await client.query<TaskArchiveSnapshotRow>(
    `SELECT t.id,
            t.workspace_id,
            t.environment_id,
            t.status,
            ts.schedule_state,
            (EXISTS (SELECT 1 FROM task_subagent_mail mail WHERE mail.recipient_task_id = t.id AND mail.delivered_at IS NULL)
             OR EXISTS (SELECT 1 FROM task_subagent_waits wait WHERE wait.task_id = t.id)) AS has_pending_work,
            t.task_history_state,
            t.task_history_archive_key,
            t.task_history_archive_failed_attempts,
            t.task_history_last_active_at,
            t.task_history_last_warmed_at
       FROM tasks t
       LEFT JOIN task_schedules ts ON ts.task_id = t.id
      WHERE t.id = $1
      FOR UPDATE OF t`,
    [taskId]
  );

  return result.rows[0] ?? null;
}

async function loadArchivePayload(client: TaskHistoryArchiveQueryable, taskId: string): Promise<{
  messages: TaskHistoryArchiveMessageEntry[];
  events: TaskHistoryArchiveEventEntry[];
  message_revisions: TaskHistoryArchiveRevisionEntry[];
}> {
  const [messagesRes, eventsRes, revisionsRes] = await Promise.all([
    client.query<TaskArchivePayloadMessageRow>(
      `SELECT id, role, content_json, token_usage_json
         FROM task_messages
        WHERE task_id = $1
        ORDER BY created_at ASC, id ASC`,
      [taskId]
    ),
    client.query<TaskArchivePayloadEventRow>(
      `SELECT id, payload_json
         FROM task_events
        WHERE task_id = $1
        ORDER BY created_at ASC, id ASC`,
      [taskId]
    ),
    client.query<TaskArchivePayloadRevisionRow>(
      `SELECT id, old_content_json, new_content_json
         FROM task_message_revisions
        WHERE task_id = $1
        ORDER BY created_at ASC, id ASC`,
      [taskId]
    )
  ]);

  return {
    messages: messagesRes.rows.map((row) => ({
      id: row.id,
      content_json: row.content_json,
      token_usage_json: row.token_usage_json
    })),
    events: eventsRes.rows.map((row) => ({
      id: row.id,
      payload_json: row.payload_json
    })),
    message_revisions: revisionsRes.rows
  };
}

async function readTaskHistoryArchiveDocument(
  archiveConfig: NormalizedTaskHistoryArchiveConfig,
  archiveKey: string
): Promise<TaskHistoryArchiveDocument> {
  if (!archiveConfig.rootPath) {
    throw new Error("Task history archive root path is not configured.");
  }

  return taskHistoryArchiveDocumentSchema.parse(await readTaskArchive(archiveConfig, archiveKey));
}

async function markTaskArchiveFailure(db: TaskHistoryArchiveDbAccess, taskId: string, error: unknown): Promise<void> {
  await db.query(
    `UPDATE tasks
        SET task_history_state = 'warm',
            task_history_archive_started_at = NULL,
            task_history_archive_error = $2,
            task_history_archive_failed_attempts = task_history_archive_failed_attempts + 1
      WHERE id = $1 AND task_history_state IN ('warm', 'archiving')`,
    [taskId, formatArchiveError(error)]
  );
}

async function applyArchiveStubs(
  client: TaskHistoryArchiveQueryable,
  taskId: string
): Promise<void> {
  const messagesRes = await client.query<TaskArchivePayloadMessageRow>(
    `SELECT id, role, content_json, token_usage_json
       FROM task_messages
      WHERE task_id = $1`,
    [taskId]
  );
  for (const row of messagesRes.rows) {
    await client.query(
      `UPDATE task_messages
          SET content_json = $2::jsonb,
              token_usage_json = NULL
        WHERE id = $1`,
      [row.id, JSON.stringify(buildTaskArchiveStub(row.role, row.content_json))]
    );
  }

  await client.query(
    `UPDATE task_events
        SET payload_json = jsonb_strip_nulls(jsonb_build_object('source', payload_json->'source', 'trigger', payload_json->'trigger'))
      WHERE task_id = $1`,
    [taskId]
  );
  await client.query(
    `UPDATE task_message_revisions
        SET old_content_json = '{}'::jsonb,
            new_content_json = '{}'::jsonb
      WHERE task_id = $1`,
    [taskId]
  );
}

async function restoreArchivedPayload(client: TaskHistoryArchiveQueryable, document: TaskHistoryArchiveDocument): Promise<void> {
  await restoreTaskArchiveRecords(client, document.task.id, "messages", document.messages);
  await restoreTaskArchiveRecords(client, document.task.id, "events", document.events);
  await restoreTaskArchiveRecords(client, document.task.id, "message_revisions", document.message_revisions);
}

export function normalizeTaskHistoryArchiveConfig(input: {
  baseDir: string;
  rawTaskHistoryArchive?: RawTaskHistoryArchiveConfig;
}): NormalizedTaskHistoryArchiveConfig {
  const parsed = taskHistoryArchiveConfigInputSchema.parse(input.rawTaskHistoryArchive);
  const archivesDir = parsed?.archivesDir?.trim() || "task-history";
  const mountPath = parsed?.mountPath?.trim()
    ? resolvePathFromRoot(input.baseDir, parsed.mountPath)
    : null;

  return {
    enabled: mountPath !== null,
    mountPath,
    archivesDir,
    rootPath: mountPath ? path.resolve(mountPath, archivesDir) : null
  };
}

export function buildTaskHistoryArchiveKey(input: {
  workspaceId: string;
  environmentId: string;
  taskId: string;
}): string {
  return path.posix.join(
    "v1",
    "workspaces",
    input.workspaceId,
    "environments",
    input.environmentId,
    "tasks",
    `${input.taskId}.json.gz`
  );
}

export function resolveTaskHistoryArchiveAbsolutePath(
  archiveConfig: NormalizedTaskHistoryArchiveConfig,
  archiveKey: string
): string {
  if (!archiveConfig.rootPath) {
    throw new Error("Task history archive root path is not configured.");
  }

  return path.resolve(archiveConfig.rootPath, archiveKey);
}

export async function getTaskHistoryArchiveHealth(
  archiveConfig: NormalizedTaskHistoryArchiveConfig,
  deps: TaskHistoryArchiveHealthDeps = {}
): Promise<TaskHistoryArchiveHealth> {
  if (!archiveConfig.enabled) {
    return {
      enabled: false,
      mountPath: archiveConfig.mountPath,
      rootPath: archiveConfig.rootPath,
      mounted: false,
      state: "disabled",
      message: "Task history archive storage is not configured."
    };
  }

  if (!archiveConfig.mountPath || !archiveConfig.rootPath) {
    return {
      enabled: true,
      mountPath: archiveConfig.mountPath,
      rootPath: archiveConfig.rootPath,
      mounted: false,
      state: "error",
      message: "Task history archive mount path is not configured."
    };
  }

  try {
    const stat = await (deps.stat ?? fsPromises.stat)(archiveConfig.mountPath);
    if (!stat.isDirectory()) {
      return {
        enabled: true,
        mountPath: archiveConfig.mountPath,
        rootPath: archiveConfig.rootPath,
        mounted: false,
        state: "error",
        message: `Archive mount path is not a directory: ${archiveConfig.mountPath}`
      };
    }

    const mounted = await (deps.isMounted ?? isMounted)(archiveConfig.mountPath);
    if (!mounted) {
      return {
        enabled: true,
        mountPath: archiveConfig.mountPath,
        rootPath: archiveConfig.rootPath,
        mounted: false,
        state: "error",
        message: `Mount is not active at ${archiveConfig.mountPath}`
      };
    }

    const rootError = await checkArchiveRootWritable(archiveConfig, deps);
    return {
      enabled: true,
      mountPath: archiveConfig.mountPath,
      rootPath: archiveConfig.rootPath,
      mounted: true,
      state: rootError ? "error" : "ready",
      message: rootError
    };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    const message = isMountedError(code)
      ? `Archive mount path does not exist: ${archiveConfig.mountPath}`
      : formatArchiveError(error);
    return {
      enabled: true,
      mountPath: archiveConfig.mountPath,
      rootPath: archiveConfig.rootPath,
      mounted: false,
      state: "error",
      message
    };
  }
}

export async function touchTaskHistoryActivity(
  client: TaskHistoryArchiveQueryable,
  taskId: string,
  activityAt: string
): Promise<void> {
  await client.query(
    `UPDATE tasks
        SET task_history_last_active_at = $2,
            task_history_archive_error = NULL,
            task_history_archive_failed_attempts = 0
      WHERE id = $1`,
    [taskId, activityAt]
  );
}

interface PreparedTaskArchive {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  archiveKey: string;
  lastActiveAt: string;
  lastWarmedAt: string | null;
  document: TaskHistoryArchiveDocument;
  references?: TaskArchiveReference[];
}

async function prepareTaskArchive(
  taskId: string, deps: TaskHistoryArchiveDeps, now: string
): Promise<PreparedTaskArchive | { reason: string }> {
  return deps.db.withTransaction(async (client) => {
    const snapshot = await loadTaskArchiveSnapshot(client, taskId);
    if (!snapshot) {
      return { reason: "Task no longer exists." };
    }

    if (snapshot.task_history_state !== "warm") {
      return { reason: `Task history state changed to ${snapshot.task_history_state}.` };
    }

    if (snapshot.status === "queued" || snapshot.status === "starting" || snapshot.status === "running") {
      return { reason: `Task became ${snapshot.status} before archiving started.` };
    }

    if (snapshot.has_pending_work) return { reason: "Task has pending subagent work." };
    if (snapshot.schedule_state === "active") {
      return { reason: "Task has an active schedule." };
    }

    const archiveKey = buildTaskHistoryArchiveKey({
      workspaceId: snapshot.workspace_id,
      environmentId: snapshot.environment_id,
      taskId: snapshot.id
    });
    const readDeps = { ...deps, db: { ...deps.db, query: client.query.bind(client) } };
    const reader: TaskHistoryPayloadReader = (id, kind, rows) => readTaskHistoryPayloads(id, kind, rows, readDeps);
    const loaded = await loadArchivePayload(client, snapshot.id);
    const payload = {
      messages: await reader(snapshot.id, "messages", loaded.messages),
      events: await reader(snapshot.id, "events", loaded.events),
      message_revisions: await reader(snapshot.id, "message_revisions", loaded.message_revisions)
    };
    const context = await loadTaskContextArchive(client, snapshot.id, reader);
    const subagents = await loadTaskSubagentArchive(client, snapshot.id);
    const swarm = await loadTaskSwarmArchive(client, snapshot.id);
    const media = await loadTaskMediaArchive(client, snapshot.id, reader);
    const conversationSnapshots = await loadConversationSnapshotArchive(client, snapshot.id, reader);

    await client.query(
      `UPDATE tasks
          SET task_history_state = 'archiving',
              task_history_archive_key = $2,
              task_history_archive_started_at = $3,
              task_history_archive_error = NULL
        WHERE id = $1`,
      [snapshot.id, archiveKey, now]
    );

    const lastActiveAt = normalizeArchiveTimestamp(snapshot.task_history_last_active_at);
    const lastWarmedAt = normalizeOptionalArchiveTimestamp(snapshot.task_history_last_warmed_at);

    return {
      taskId: snapshot.id,
      workspaceId: snapshot.workspace_id,
      environmentId: snapshot.environment_id,
      archiveKey,
      lastActiveAt,
      lastWarmedAt,
      document: {
        version: TASK_HISTORY_ARCHIVE_VERSION,
        context,
        subagents,
        swarm,
        media,
        conversation_snapshots: conversationSnapshots,
        task: {
          id: snapshot.id,
          workspace_id: snapshot.workspace_id,
          environment_id: snapshot.environment_id,
          archived_at: now,
          last_active_at: lastActiveAt
        },
        messages: payload.messages,
        events: payload.events,
        message_revisions: payload.message_revisions
      }
    };
  });
}

async function finishTaskArchive(
  preparedArchive: PreparedTaskArchive, deps: TaskHistoryArchiveDeps, now: string
): Promise<string | null> {
  return deps.db.withTransaction(async (client) => {
    const snapshot = await loadTaskArchiveSnapshot(client, preparedArchive.taskId);
    if (!snapshot) {
      return "Task was deleted while its archive was being written.";
    }

    if (snapshot.task_history_state !== "archiving") {
      return `Task history state changed to ${snapshot.task_history_state} while its archive was being written.`;
    }

    if (
      snapshot.has_pending_work || snapshot.schedule_state === "active"
      || ["queued", "starting", "running"].includes(snapshot.status)
      || normalizeArchiveTimestamp(snapshot.task_history_last_active_at) !== preparedArchive.lastActiveAt
      || normalizeOptionalArchiveTimestamp(snapshot.task_history_last_warmed_at) !== preparedArchive.lastWarmedAt
    ) {
      await client.query(
        `UPDATE tasks
            SET task_history_state = 'warm',
                task_history_archive_started_at = NULL,
                task_history_archive_error = NULL,
                task_history_archive_failed_attempts = 0
          WHERE id = $1`,
        [preparedArchive.taskId]
      );
      return "Task became active while its archive was being written.";
    }

    await applyArchiveStubs(client, preparedArchive.taskId);
    await stubTaskContextArchive(client, preparedArchive.taskId);
    await stubTaskSubagentArchive(client, preparedArchive.taskId);
    await stubTaskSwarmArchive(client, preparedArchive.taskId);
    await stubTaskMediaArchive(client, preparedArchive.taskId);
    await stubConversationSnapshotArchive(client, preparedArchive.taskId);
    await publishTaskArchiveReferences(client, preparedArchive.taskId, preparedArchive.references ?? []);
    await client.query(
      `UPDATE tasks
          SET task_history_state = 'archived',
              task_history_archive_conversion_requested = false,
              task_history_archive_key = $2,
              task_history_archived_at = $3,
              task_history_archive_started_at = NULL,
              task_history_archive_error = NULL,
              task_history_archive_failed_attempts = 0
        WHERE id = $1`,
      [preparedArchive.taskId, preparedArchive.archiveKey, now]
    );
    return null;
  });
}

export async function archiveTaskHistory(
  taskId: string,
  deps: TaskHistoryArchiveDeps
): Promise<ArchiveTaskHistoryResult> {
  if (!deps.archiveConfig.enabled) {
    return { status: "skipped", reason: "Task history archive storage is not configured." };
  }
  const now = (deps.now ?? (() => new Date()))().toISOString();
  let prepared: PreparedTaskArchive | null = null;
  try {
    const result = await prepareTaskArchive(taskId, deps, now);
    if ("reason" in result) return { status: "skipped", reason: result.reason };
    prepared = result;
    const sizeMetrics = await writeTaskArchive(deps.archiveConfig, prepared.document);
    prepared.archiveKey = sizeMetrics.archiveKey;
    prepared.references = sizeMetrics.references;
    const reason = await finishTaskArchive(prepared, deps, now);
    if (reason) return { status: "skipped", reason };
    deps.logger?.info?.(`[task-history] Archived task ${prepared.taskId} to ${prepared.archiveKey}`);
    return {
      status: "archived",
      archiveKey: prepared.archiveKey,
      metrics: {
        ...sizeMetrics,
        messageCount: prepared.document.messages.length,
        eventCount: prepared.document.events.length,
        revisionCount: prepared.document.message_revisions.length
      }
    };
  } catch (error) {
    await markTaskArchiveFailure(deps.db, prepared?.taskId ?? taskId, error).catch(() => undefined);
    throw error;
  }
}

async function restoreDocument(client: TaskHistoryArchiveQueryable, document: TaskHistoryArchiveDocument): Promise<void> {
  await restoreArchivedPayload(client, document);
  await restoreTaskContextArchive(client, document.context, document.task.id);
  await restoreTaskSubagentArchive(client, document.subagents);
  await restoreTaskSwarmArchive(client, document.swarm);
  await restoreTaskMediaArchive(client, document.task.id, document.media);
  await restoreConversationSnapshotArchive(client, document.conversation_snapshots);
  await clearRestoredArchiveReferences(client, document.task.id, document);
}

async function restoreArchivedTask(
  taskId: string, document: TaskHistoryArchiveDocument, deps: TaskHistoryArchiveDeps, warmedAt: string
): Promise<boolean> {
  return deps.db.withTransaction(async (client) => {
    const snapshot = await loadTaskArchiveSnapshot(client, taskId);
    if (!snapshot) {
      return false;
    }

    if (snapshot.task_history_state === "warm") {
      return false;
    }

    if (snapshot.task_history_state === "archiving") {
      await client.query(
        `UPDATE tasks
            SET task_history_state = 'warm',
                task_history_last_warmed_at = $2,
                task_history_archive_started_at = NULL,
                task_history_archive_error = NULL,
                task_history_archive_failed_attempts = 0
          WHERE id = $1`,
        [taskId, warmedAt]
      );
      return false;
    }

    if (document.task.id !== taskId || document.task.workspace_id !== snapshot.workspace_id || document.task.environment_id !== snapshot.environment_id) {
      throw new Error("Archive does not belong to this task.");
    }
    await restoreDocument(client, document);
    await client.query(
      `UPDATE tasks
          SET task_history_state = 'warm',
              task_history_last_warmed_at = $2,
              task_history_archive_started_at = NULL,
              task_history_archive_error = NULL,
              task_history_archive_failed_attempts = 0
        WHERE id = $1`,
      [taskId, warmedAt]
    );
    return true;
  });
}

export async function ensureTaskHistoryWarm(
  taskId: string,
  deps: TaskHistoryArchiveDeps,
  options: { executionOnly?: boolean } = {}
): Promise<EnsureTaskHistoryWarmResult> {
  let pendingArchiveKey: string | null = null;
  const warmedAt = (deps.now ?? (() => new Date()))().toISOString();

  const initial = await deps.db.withTransaction(async (client) => {
    const snapshot = await loadTaskArchiveSnapshot(client, taskId);
    if (!snapshot) {
      return { status: "not_found" as const };
    }
    // Only execution and mutation paths call this function; browsing never does.
    await touchTaskHistoryActivity(client, taskId, warmedAt);

    if (snapshot.task_history_state === "warm") {
      return { status: "warm" as const };
    }

    if (snapshot.task_history_state === "archiving") {
      await client.query(
        `UPDATE tasks
            SET task_history_state = 'warm',
                task_history_last_warmed_at = $2,
                task_history_archive_started_at = NULL,
                task_history_archive_error = NULL,
                task_history_archive_failed_attempts = 0
          WHERE id = $1`,
        [taskId, warmedAt]
      );
      return { status: "warm" as const };
    }

    pendingArchiveKey = snapshot.task_history_archive_key;
    return { status: "archived" as const };
  });

  if (initial.status === "not_found") {
    return { status: "not_found" };
  }
  if (initial.status === "warm") {
    if (!options.executionOnly && deps.archiveConfig.enabled) await materializeWarmTaskPayloads(taskId, deps, restoreDocument);
    return { status: "warm" };
  }
  if (!pendingArchiveKey) {
    throw new Error(`Task ${taskId} is archived but has no archive key.`);
  }

  const document = options.executionOnly
    ? await readTaskExecutionArchive(taskId, pendingArchiveKey, deps)
    : await readTaskHistoryArchiveDocument(deps.archiveConfig, pendingArchiveKey);

  const restored = await restoreArchivedTask(taskId, document, deps, warmedAt);

  if (restored) {
    deps.logger?.info?.(`[task-history] Restored archived task ${taskId}`);
    return { status: "restored" };
  }

  if (!options.executionOnly) await materializeWarmTaskPayloads(taskId, deps, restoreDocument);
  return { status: "warm" };
}

export async function resetStaleArchivingTasks(
  db: TaskHistoryArchiveDbAccess,
  now: Date = new Date()
): Promise<number> {
  const staleBefore = new Date(now.getTime() - ARCHIVE_STALE_AFTER_MS).toISOString();
  const result = await db.query<{ id: string }>(
    `UPDATE tasks
        SET task_history_state = 'warm',
            task_history_archive_started_at = NULL,
            task_history_archive_error = 'Reset stale archive state after worker interruption.',
            task_history_archive_failed_attempts = task_history_archive_failed_attempts + 1
      WHERE task_history_state = 'archiving'
        AND task_history_archive_started_at IS NOT NULL
        AND task_history_archive_started_at < $1
    RETURNING id`,
    [staleBefore]
  );
  return result.rowCount ?? 0;
}

export async function deleteTaskHistoryArchiveByKey(
  archiveConfig: NormalizedTaskHistoryArchiveConfig,
  archiveKey: string | null | undefined
): Promise<void> {
  if (!archiveKey || !archiveConfig.rootPath) {
    return;
  }

  const match = /^(v[12])\/(workspaces\/[^/]+\/environments\/[^/]+\/tasks\/[^/]+?)(?:\.json\.gz|\/(?:chunks|manifests)\/[^/]+)$/.exec(archiveKey);
  if (!match) throw new Error("Invalid task archive key.");
  await fsPromises.rm(taskArchivePath(archiveConfig, `v2/${match[2]}`), { recursive: true, force: true });
  await fsPromises.rm(taskArchivePath(archiveConfig, `v1/${match[2]}.json.gz`), { force: true });
}
