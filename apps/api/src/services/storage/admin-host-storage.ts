import {
  TASK_EVENT_INSERT_PRUNE_LIMIT,
  TASK_EVENT_RETENTION_BACKLOG_INTERVAL_MS,
  TASK_EVENT_RETENTION_DELETE_LIMIT,
  TASK_EVENT_RETENTION_LIMIT,
  TASK_EVENT_RETENTION_SAFETY_INTERVAL_MS,
  pruneTaskEvents
} from "@meowbert/shared";
import { query, withConnection } from "../../lib/db.js";
import { getConfiguredTaskHistoryArchiveHealth } from "../tasks/task-history.js";

const HOST_STORAGE_RELATION_LIMIT = 12;
const HOST_STORAGE_ARCHIVE_RUN_LIMIT = 20;
const TASK_EVENTS_VACUUM_LOCK_NAMESPACE = 1_296_382;
const TASK_EVENTS_VACUUM_LOCK_ID = 1;

interface HostStorageSettingsRow {
  debug_mode: boolean;
  task_history_warm_retention_days: number;
}

interface PostgresDatabaseSizeRow {
  database_name: string;
  database_bytes: string;
}

interface PostgresRelationSizeRow {
  relation_name: string;
  table_bytes: string;
  index_bytes: string;
  total_bytes: string;
  estimated_live_rows: string;
  estimated_dead_rows: string;
  last_vacuum_at: string | null;
  last_autovacuum_at: string | null;
}

interface AdvisoryLockRow {
  locked: boolean;
}

interface RelationTotalSizeRow {
  total_bytes: string;
}

interface TaskHistoryStateCountsRow {
  warm_count: string;
  archiving_count: string;
  archived_count: string;
  failed_count: string;
  eligible_count: string;
}

interface TaskHistoryArchiveRunRow {
  id: string;
  task_id: string | null;
  task_title: string | null;
  trigger_source: "scheduled" | "manual";
  status: "queued" | "running" | "completed" | "skipped" | "failed";
  archive_key: string | null;
  original_size_bytes: string | null;
  compressed_size_bytes: string | null;
  message_count: number | null;
  event_count: number | null;
  revision_count: number | null;
  workflow_message_count: number | null;
  error_summary: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AdminPostgresRelationStorage {
  name: string;
  tableBytes: number;
  indexBytes: number;
  totalBytes: number;
  estimatedLiveRows: number;
  estimatedDeadRows: number;
  lastVacuumAt: string | null;
  lastAutovacuumAt: string | null;
}

export interface AdminTaskHistoryArchiveRun {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  triggerSource: "scheduled" | "manual";
  status: "queued" | "running" | "completed" | "skipped" | "failed";
  archiveKey: string | null;
  originalSizeBytes: number | null;
  compressedSizeBytes: number | null;
  messageCount: number | null;
  eventCount: number | null;
  revisionCount: number | null;
  workflowMessageCount: number | null;
  errorSummary: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AdminHostStorageOverview {
  postgres: {
    databaseName: string;
    databaseBytes: number;
    relations: AdminPostgresRelationStorage[];
  };
  eventRetention: {
    debugMode: boolean;
    pruningEnabled: boolean;
    retainedEventsPerTask: number;
    insertPruneBatchSize: number;
    backlogIntervalSeconds: number;
    backlogDeleteBatchSize: number;
    safetyIntervalHours: number;
  };
  taskHistoryArchive: {
    enabled: boolean;
    mountPath: string | null;
    rootPath: string | null;
    mounted: boolean;
    healthState: "ready" | "error" | "disabled";
    healthMessage: string | null;
    warmRetentionDays: number;
    warmTaskCount: number;
    archivingTaskCount: number;
    archivedTaskCount: number;
    failedTaskCount: number;
    eligibleTaskCount: number;
    recentRuns: AdminTaskHistoryArchiveRun[];
  };
}

export interface AdminTaskEventsVacuumFullResult {
  startedAt: string;
  completedAt: string;
  beforeBytes: number;
  afterBytes: number;
  reclaimedBytes: number;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadHostStorageSettings(): Promise<HostStorageSettingsRow> {
  const result = await query<HostStorageSettingsRow>(
    `SELECT COALESCE(debug_mode, false) AS debug_mode,
            COALESCE(task_history_warm_retention_days, 0)::int AS task_history_warm_retention_days
       FROM platform_settings
      WHERE id = 1`
  );
  return result.rows[0] ?? {
    debug_mode: false,
    task_history_warm_retention_days: 0
  };
}

async function loadPostgresStorage(): Promise<AdminHostStorageOverview["postgres"]> {
  const [databaseRes, relationsRes] = await Promise.all([
    query<PostgresDatabaseSizeRow>(
      `SELECT current_database() AS database_name,
              pg_database_size(current_database())::text AS database_bytes`
    ),
    query<PostgresRelationSizeRow>(
      `SELECT relname AS relation_name,
              pg_table_size(relid)::text AS table_bytes,
              pg_indexes_size(relid)::text AS index_bytes,
              pg_total_relation_size(relid)::text AS total_bytes,
              n_live_tup::text AS estimated_live_rows,
              n_dead_tup::text AS estimated_dead_rows,
              last_vacuum::text AS last_vacuum_at,
              last_autovacuum::text AS last_autovacuum_at
         FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(relid) DESC, relname ASC
        LIMIT $1`,
      [HOST_STORAGE_RELATION_LIMIT]
    )
  ]);
  const database = databaseRes.rows[0];
  return {
    databaseName: database?.database_name ?? "unknown",
    databaseBytes: toNumber(database?.database_bytes),
    relations: relationsRes.rows.map((row) => ({
      name: row.relation_name,
      tableBytes: toNumber(row.table_bytes),
      indexBytes: toNumber(row.index_bytes),
      totalBytes: toNumber(row.total_bytes),
      estimatedLiveRows: toNumber(row.estimated_live_rows),
      estimatedDeadRows: toNumber(row.estimated_dead_rows),
      lastVacuumAt: row.last_vacuum_at,
      lastAutovacuumAt: row.last_autovacuum_at
    }))
  };
}

async function loadTaskHistoryStateCounts(
  warmRetentionDays: number
): Promise<TaskHistoryStateCountsRow> {
  const cutoffIso = new Date(
    Date.now() - warmRetentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const result = await query<TaskHistoryStateCountsRow>(
    `SELECT COUNT(*) FILTER (WHERE t.task_history_state = 'warm')::text AS warm_count,
            COUNT(*) FILTER (WHERE t.task_history_state = 'archiving')::text AS archiving_count,
            COUNT(*) FILTER (WHERE t.task_history_state = 'archived')::text AS archived_count,
            COUNT(*) FILTER (WHERE t.task_history_archive_failed_attempts > 0)::text AS failed_count,
            COUNT(*) FILTER (
              WHERE $1::int > 0
                AND t.task_history_state = 'warm'
                AND t.task_history_archive_failed_attempts < 3
                AND t.status NOT IN ('queued', 'starting', 'running')
                AND COALESCE(ts.schedule_state, 'cancelled') <> 'active'
                AND GREATEST(
                  t.task_history_last_active_at,
                  COALESCE(t.task_history_last_warmed_at, to_timestamp(0))
                ) < $2::timestamptz
            )::text AS eligible_count
       FROM tasks t
       LEFT JOIN task_schedules ts ON ts.task_id = t.id`,
    [warmRetentionDays, cutoffIso]
  );
  return result.rows[0] ?? {
    warm_count: "0",
    archiving_count: "0",
    archived_count: "0",
    failed_count: "0",
    eligible_count: "0"
  };
}

async function listRecentTaskHistoryArchiveRuns(): Promise<AdminTaskHistoryArchiveRun[]> {
  const result = await query<TaskHistoryArchiveRunRow>(
    `SELECT run.id,
            run.task_id,
            task.title AS task_title,
            run.trigger_source,
            run.status,
            run.archive_key,
            run.original_size_bytes::text,
            run.compressed_size_bytes::text,
            run.message_count,
            run.event_count,
            run.revision_count,
            run.workflow_message_count,
            run.error_summary,
            run.created_at::text,
            run.started_at::text,
            run.completed_at::text
       FROM task_history_archive_runs run
       LEFT JOIN tasks task ON task.id = run.task_id
      ORDER BY run.created_at DESC, run.id DESC
      LIMIT $1`,
    [HOST_STORAGE_ARCHIVE_RUN_LIMIT]
  );
  return result.rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    triggerSource: row.trigger_source,
    status: row.status,
    archiveKey: row.archive_key,
    originalSizeBytes: row.original_size_bytes === null ? null : toNumber(row.original_size_bytes),
    compressedSizeBytes: row.compressed_size_bytes === null ? null : toNumber(row.compressed_size_bytes),
    messageCount: row.message_count,
    eventCount: row.event_count,
    revisionCount: row.revision_count,
    workflowMessageCount: row.workflow_message_count,
    errorSummary: row.error_summary,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }));
}

export async function listAdminHostStorageOverview(): Promise<AdminHostStorageOverview> {
  const settings = await loadHostStorageSettings();
  const [postgres, health, stateCounts, recentRuns] = await Promise.all([
    loadPostgresStorage(),
    getConfiguredTaskHistoryArchiveHealth(),
    loadTaskHistoryStateCounts(settings.task_history_warm_retention_days),
    listRecentTaskHistoryArchiveRuns()
  ]);
  return {
    postgres,
    eventRetention: {
      debugMode: settings.debug_mode,
      pruningEnabled: !settings.debug_mode,
      retainedEventsPerTask: TASK_EVENT_RETENTION_LIMIT,
      insertPruneBatchSize: TASK_EVENT_INSERT_PRUNE_LIMIT,
      backlogIntervalSeconds: TASK_EVENT_RETENTION_BACKLOG_INTERVAL_MS / 1000,
      backlogDeleteBatchSize: TASK_EVENT_RETENTION_DELETE_LIMIT,
      safetyIntervalHours: TASK_EVENT_RETENTION_SAFETY_INTERVAL_MS / (60 * 60 * 1000)
    },
    taskHistoryArchive: {
      enabled: health.enabled,
      mountPath: health.mountPath,
      rootPath: health.rootPath,
      mounted: health.mounted,
      healthState: health.state,
      healthMessage: health.message,
      warmRetentionDays: settings.task_history_warm_retention_days,
      warmTaskCount: toNumber(stateCounts.warm_count),
      archivingTaskCount: toNumber(stateCounts.archiving_count),
      archivedTaskCount: toNumber(stateCounts.archived_count),
      failedTaskCount: toNumber(stateCounts.failed_count),
      eligibleTaskCount: toNumber(stateCounts.eligible_count),
      recentRuns
    }
  };
}

export async function pruneAdminTaskEvents() {
  return pruneTaskEvents(query);
}

export async function vacuumFullAdminTaskEvents(): Promise<AdminTaskEventsVacuumFullResult> {
  return withConnection(async (client) => {
    const lockRes = await client.query<AdvisoryLockRow>(
      "SELECT pg_try_advisory_lock($1::int, $2::int) AS locked",
      [TASK_EVENTS_VACUUM_LOCK_NAMESPACE, TASK_EVENTS_VACUUM_LOCK_ID]
    );
    if (lockRes.rows[0]?.locked !== true) {
      throw new Error("A task-events VACUUM FULL operation is already running.");
    }

    const startedAt = new Date().toISOString();
    try {
      const beforeRes = await client.query<RelationTotalSizeRow>(
        "SELECT pg_total_relation_size('public.task_events'::regclass)::text AS total_bytes"
      );
      await client.query("VACUUM (FULL, ANALYZE) public.task_events");
      const afterRes = await client.query<RelationTotalSizeRow>(
        "SELECT pg_total_relation_size('public.task_events'::regclass)::text AS total_bytes"
      );
      const beforeBytes = toNumber(beforeRes.rows[0]?.total_bytes);
      const afterBytes = toNumber(afterRes.rows[0]?.total_bytes);
      return {
        startedAt,
        completedAt: new Date().toISOString(),
        beforeBytes,
        afterBytes,
        reclaimedBytes: Math.max(0, beforeBytes - afterBytes)
      };
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock($1::int, $2::int)",
        [TASK_EVENTS_VACUUM_LOCK_NAMESPACE, TASK_EVENTS_VACUUM_LOCK_ID]
      ).catch(() => undefined);
    }
  });
}

export async function queueAdminTaskHistoryArchive(input: {
  requestedByUserId: string;
}): Promise<AdminTaskHistoryArchiveRun> {
  const settings = await loadHostStorageSettings();
  const health = await getConfiguredTaskHistoryArchiveHealth();
  if (health.state !== "ready") {
    throw new Error(health.message ?? "Cold storage is not ready.");
  }
  if (settings.task_history_warm_retention_days <= 0) {
    throw new Error("Set a warm retention period before archiving task history.");
  }

  const activeRes = await query<TaskHistoryArchiveRunRow>(
    `SELECT run.id,
            run.task_id,
            task.title AS task_title,
            run.trigger_source,
            run.status,
            run.archive_key,
            run.original_size_bytes::text,
            run.compressed_size_bytes::text,
            run.message_count,
            run.event_count,
            run.revision_count,
            run.workflow_message_count,
            run.error_summary,
            run.created_at::text,
            run.started_at::text,
            run.completed_at::text
      FROM task_history_archive_runs run
      LEFT JOIN tasks task ON task.id = run.task_id
      WHERE run.trigger_source = 'manual'
        AND run.status = 'queued'
      ORDER BY run.created_at ASC, run.id ASC
      LIMIT 1`
  );
  if (activeRes.rows[0]) {
    return mapArchiveRun(activeRes.rows[0]);
  }

  const inserted = await query<TaskHistoryArchiveRunRow>(
    `INSERT INTO task_history_archive_runs (
       requested_by_user_id,
       trigger_source,
       status
     ) VALUES ($1, 'manual', 'queued')
     RETURNING id,
               task_id,
               NULL::text AS task_title,
               trigger_source,
               status,
               archive_key,
               original_size_bytes::text,
               compressed_size_bytes::text,
               message_count,
               event_count,
               revision_count,
               workflow_message_count,
               error_summary,
               created_at::text,
               started_at::text,
               completed_at::text`,
    [input.requestedByUserId]
  );
  const row = inserted.rows[0];
  if (!row) {
    throw new Error("Failed to queue cold-storage archive request.");
  }
  return mapArchiveRun(row);
}

function mapArchiveRun(row: TaskHistoryArchiveRunRow): AdminTaskHistoryArchiveRun {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    triggerSource: row.trigger_source,
    status: row.status,
    archiveKey: row.archive_key,
    originalSizeBytes: row.original_size_bytes === null ? null : toNumber(row.original_size_bytes),
    compressedSizeBytes: row.compressed_size_bytes === null ? null : toNumber(row.compressed_size_bytes),
    messageCount: row.message_count,
    eventCount: row.event_count,
    revisionCount: row.revision_count,
    workflowMessageCount: row.workflow_message_count,
    errorSummary: row.error_summary,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}
