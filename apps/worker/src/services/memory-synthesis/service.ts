import { randomUUID } from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  createTaskMessageMetadata,
  ensureSandboxWritablePath,
  type TaskExecutionJob
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { redis } from "../../lib/redis.js";
import { resolveTaskEnvironmentRoot } from "../runtime/environment-storage.js";
import { insertTaskRunDispatchWithClient } from "../tasks/task-run-dispatch.js";
import {
  calculateMemorySynthesisUrgency,
  calculateUserSessionsWeightedCount,
  MEMORY_SYNTHESIS_MIN_REFRESH_INTERVAL_MS,
  MEMORY_SYNTHESIS_URGENCY_THRESHOLD
} from "./urgency.js";

const MAX_DELTA_MESSAGES = 120;
const MAX_DELTA_CHARS = 120_000;
const MEMORY_SYNTHESIS_EVENT_CHANNEL = "memory_synthesis_ready";

interface SynthesisRequestRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  initiator_user_id: string | null;
  source_through_at: string | null;
}

interface DeltaMessageRow {
  role: "user" | "assistant";
  text: string;
  created_at: string;
  task_title: string | null;
}

interface MemorySynthesisMetricsRow {
  workspace_id: string;
  environment_id: string;
  initiator_user_id: string | null;
  last_refresh_at: string | null;
  earliest_delta_at: string | null;
  delta_char_count: number;
  session_tokens_json: number[] | null;
}

interface MemorySynthesisEvent {
  workspaceId: string;
  environmentId: string;
}

function buildSynthesisPrompt(): string {
  return [
    "Refresh the persistent Memory for this workspace and Project.",
    "Read `inputs/memory-delta.md` before making any change.",
    "Memory is a store of persistent, reusable knowledge, not a summary or transcript of conversations.",
    "Extract only durable, clearly evidenced facts, decisions, constraints, preferences, commands, canonical references, and long-lived active context that a future agent is likely to need.",
    "Do not write a chronological recap of the delta or retain turn-by-turn progress, temporary investigation notes, routine task outcomes, or details useful only for reconstructing a conversation.",
    "Use the current time in the system prompt to retire or revise time-sensitive facts that are no longer current.",
    "Clean up clearly useless Memory as you refresh it: remove obsolete or temporary notes, consolidate duplicates, and trim details that no longer help future runs. Use judgment and preserve anything still plausibly useful.",
    "Prefix every new Memory entry with the current date and time.",
    "Write project-specific knowledge under the Project Memory directory and workspace-wide knowledge under the Workspace Memory directory.",
    "Also create or update `actions.json` in the Project Memory directory with up to 8 (typically 3-6) concise, relevant suggested starter actions for this Project. Do not fill it with random actions based on what the user has done before, and do not blindly guess what the user will want next. Choose actions with judgment from one or more of these categories: very frequently used actions or automations; broadly useful actions the user may reasonably want to take in this Project even if they have not explicitly requested them before (for example, reviewing the current paper draft); or creative, fun, and useful actions grounded in the Project context (for example, learning fun facts about a topic, researching an interesting angle, or exploring a promising idea). Be creative while keeping every suggestion concrete, useful, and grounded in the current Project context. Format as a JSON array of objects with `id`, `label` (concise button label), `prompt` (actionable starter prompt for the task composer), and optional `icon` ('sparkles', 'code', 'globe', 'terminal', 'search', 'zap').",
    "Do not invent facts, copy transient discussion, or create duplicate notes. If no update is warranted, leave Memory unchanged.",
    "Finish with a short final response describing any files changed."
  ].join("\n");
}

function formatDelta(messages: DeltaMessageRow[]): string {
  const lines = ["# Conversation delta", ""];
  let remaining = MAX_DELTA_CHARS;

  for (const message of messages) {
    const heading = `## ${message.role === "user" ? "User" : "Agent"} · ${message.created_at}${message.task_title ? ` · ${message.task_title}` : ""}`;
    const text = message.text.trim();
    if (!text || remaining <= heading.length + 4) {
      continue;
    }
    const bounded = text.slice(0, Math.max(0, remaining - heading.length - 4));
    lines.push(heading, "", bounded, "");
    remaining -= heading.length + bounded.length + 4;
  }

  return lines.join("\n");
}

export async function syncFinishedMemorySynthesisRequests(): Promise<void> {
  await query(
    `UPDATE memory_synthesis_requests request
        SET status = CASE task.status
              WHEN 'succeeded' THEN 'succeeded'
              ELSE 'failed'
            END,
            completed_at = now(),
            error_summary = CASE
              WHEN task.status = 'succeeded' THEN NULL
              ELSE COALESCE(latest_run.error_summary, 'Memory synthesis task did not complete.')
            END,
            updated_at = now()
       FROM tasks task
       LEFT JOIN LATERAL (
         SELECT error_summary
           FROM task_runs
          WHERE task_id = task.id
          ORDER BY attempt_no DESC, id DESC
          LIMIT 1
       ) latest_run ON true
      WHERE request.task_id = task.id
        AND request.status = 'running'
        AND task.status IN ('succeeded', 'failed', 'cancelled')`
  );
}

async function loadMemorySynthesisMetrics(input: MemorySynthesisEvent): Promise<MemorySynthesisMetricsRow | null> {
  const result = await query<MemorySynthesisMetricsRow>(
    `WITH latest_success AS (
       SELECT source_through_at, completed_at
         FROM memory_synthesis_requests
        WHERE environment_id = $2
          AND status = 'succeeded'
        ORDER BY source_through_at DESC NULLS LAST, completed_at DESC NULLS LAST
        LIMIT 1
     ), latest_refresh AS (
       SELECT completed_at
         FROM memory_synthesis_requests
        WHERE environment_id = $2
          AND status IN ('succeeded', 'failed')
        ORDER BY completed_at DESC NULLS LAST
        LIMIT 1
     ), delta_messages AS (
       SELECT tm.role,
              tm.author_user_id,
              tm.created_at,
              COALESCE(tm.content_json->>'text', '') AS text,
              t.id AS task_id,
              t.status AS task_status,
              t.completed_at
         FROM task_messages tm
         JOIN tasks t ON t.id = tm.task_id
         LEFT JOIN memory_synthesis_requests synthesis_task ON synthesis_task.task_id = t.id
         LEFT JOIN latest_success success ON true
        WHERE t.environment_id = $2
          AND tm.role IN ('user', 'assistant')
          AND tm.created_at > COALESCE(success.source_through_at, to_timestamp(0))
          AND synthesis_task.id IS NULL
     ), active_user_tasks AS (
       SELECT DISTINCT task_id
         FROM delta_messages
        WHERE role = 'user' AND author_user_id IS NOT NULL
     ), task_token_usage AS (
       SELECT ute.task_id,
              SUM(ute.input_tokens + ute.output_tokens)::bigint AS recorded_tokens
         FROM user_token_usage_events ute
         JOIN active_user_tasks aut ON aut.task_id = ute.task_id
         LEFT JOIN latest_success success ON true
        WHERE ute.occurred_at > COALESCE(success.source_through_at, to_timestamp(0))
        GROUP BY ute.task_id
     ), task_delta_text AS (
       SELECT delta.task_id,
              SUM(LEAST(length(delta.text), 16_000))::bigint AS task_char_count
         FROM delta_messages delta
         JOIN active_user_tasks aut ON aut.task_id = delta.task_id
        GROUP BY delta.task_id
     ), session_stats AS (
       SELECT aut.task_id,
              COALESCE(
                ttu.recorded_tokens,
                tdt.task_char_count * 12,
                0
              )::bigint AS session_tokens
         FROM active_user_tasks aut
         LEFT JOIN task_token_usage ttu ON ttu.task_id = aut.task_id
         LEFT JOIN task_delta_text tdt ON tdt.task_id = aut.task_id
     )
     SELECT e.workspace_id,
            e.id AS environment_id,
            (
              SELECT author_user_id
                FROM delta_messages
               WHERE role = 'user'
                 AND author_user_id IS NOT NULL
               ORDER BY created_at DESC
               LIMIT 1
            ) AS initiator_user_id,
            refresh.completed_at::text AS last_refresh_at,
            MIN(delta.created_at)::text AS earliest_delta_at,
            COALESCE(SUM(LEAST(length(delta.text), 16_000)), 0)::int AS delta_char_count,
            COALESCE(
              (SELECT json_agg(session_tokens) FROM session_stats),
              '[]'::json
            ) AS session_tokens_json
       FROM environments e
       JOIN workspace_settings ws ON ws.workspace_id = e.workspace_id
       LEFT JOIN latest_success success ON true
       LEFT JOIN latest_refresh refresh ON true
       LEFT JOIN delta_messages delta ON true
      WHERE e.id = $2
        AND e.workspace_id = $1
        AND e.status = 'active'
        AND ws.memory_enabled = true
        AND COALESCE((ws.model_defaults_json->>'memorySynthesisEnabled')::boolean, false) = true
        AND NOT (e.json_payload @> '{"memorySynthesisEnabled": false}'::jsonb)
        AND NOT EXISTS (
          SELECT 1
            FROM memory_synthesis_requests active_request
           WHERE active_request.environment_id = e.id
             AND active_request.status IN ('queued', 'running')
        )
      GROUP BY e.workspace_id, e.id, success.source_through_at, refresh.completed_at`,
    [input.workspaceId, input.environmentId]
  );
  return result.rows[0] ?? null;
}

async function queueAutomaticRequest(input: MemorySynthesisEvent): Promise<boolean> {
  const metrics = await loadMemorySynthesisMetrics(input);
  const sessionTokens = Array.isArray(metrics?.session_tokens_json)
    ? metrics.session_tokens_json.map((val) => Number(val) || 0)
    : [];
  if (!metrics || sessionTokens.length === 0 || !metrics.initiator_user_id) {
    return false;
  }
  if (metrics.last_refresh_at && Date.now() - new Date(metrics.last_refresh_at).getTime() < MEMORY_SYNTHESIS_MIN_REFRESH_INTERVAL_MS) {
    return false;
  }
  const userSessionsWeightedCount = calculateUserSessionsWeightedCount(sessionTokens);
  const urgency = calculateMemorySynthesisUrgency({
    now: new Date(),
    lastRefreshAt: metrics.last_refresh_at,
    earliestDeltaAt: metrics.earliest_delta_at,
    userSessionsWeightedCount,
    deltaCharCount: metrics.delta_char_count
  });
  if (urgency < MEMORY_SYNTHESIS_URGENCY_THRESHOLD) {
    return false;
  }
  const inserted = await query(
    `INSERT INTO memory_synthesis_requests (workspace_id, environment_id, initiator_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [metrics.workspace_id, metrics.environment_id, metrics.initiator_user_id]
  );
  return (inserted.rowCount ?? 0) > 0;
}

async function claimNextRequest(input?: MemorySynthesisEvent): Promise<SynthesisRequestRow | null> {
  return withTransaction(async (client) => {
    const requestRes = await client.query<SynthesisRequestRow>(
      `SELECT id, workspace_id, environment_id, initiator_user_id, source_through_at
         FROM memory_synthesis_requests
        WHERE status = 'queued'
          AND ($1::uuid IS NULL OR workspace_id = $1)
          AND ($2::uuid IS NULL OR environment_id = $2)
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [input?.workspaceId ?? null, input?.environmentId ?? null]
    );
    const request = requestRes.rows[0];
    if (!request) {
      return null;
    }

    await client.query(
      `UPDATE memory_synthesis_requests
          SET status = 'running', started_at = now(), updated_at = now()
        WHERE id = $1`,
      [request.id]
    );
    return request;
  });
}

async function loadDelta(input: {
  environmentId: string;
  sourceAfter: string | null;
}): Promise<DeltaMessageRow[]> {
  const result = await query<DeltaMessageRow>(
    `SELECT tm.role,
            COALESCE(tm.content_json->>'text', '') AS text,
            tm.created_at,
            t.title AS task_title
       FROM task_messages tm
       JOIN tasks t ON t.id = tm.task_id
       LEFT JOIN memory_synthesis_requests synthesis_task ON synthesis_task.task_id = t.id
      WHERE t.environment_id = $1
        AND tm.role IN ('user', 'assistant')
        AND tm.created_at > COALESCE($2::timestamptz, to_timestamp(0))
        AND synthesis_task.id IS NULL
      ORDER BY tm.created_at ASC, tm.id ASC
      LIMIT $3`,
    [input.environmentId, input.sourceAfter, MAX_DELTA_MESSAGES]
  );
  return result.rows;
}

async function loadLatestCompletedCursor(environmentId: string): Promise<string | null> {
  const result = await query<{ source_through_at: string | null }>(
    `SELECT source_through_at
       FROM memory_synthesis_requests
      WHERE environment_id = $1
        AND status = 'succeeded'
      ORDER BY source_through_at DESC NULLS LAST, completed_at DESC NULLS LAST
      LIMIT 1`,
    [environmentId]
  );
  return result.rows[0]?.source_through_at ?? null;
}

async function createSynthesisTask(input: {
  request: SynthesisRequestRow;
  delta: DeltaMessageRow[];
}): Promise<void> {
  const taskId = randomUUID();
  const runId = randomUUID();
  const sourceThroughAt = input.delta.at(-1)?.created_at ?? null;
  const environmentRes = await query<{ root_path: string; storage_backend_id: string }>(
    `SELECT e.root_path, w.storage_backend_id
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
      WHERE e.id = $1
        AND e.workspace_id = $2`,
    [input.request.environment_id, input.request.workspace_id]
  );
  const environment = environmentRes.rows[0];
  if (!environment) {
    throw new Error("Project not found for memory synthesis.");
  }

  const taskRootPath = `.meowbert/task-runs/${taskId}`;
  const taskDir = path.resolve(
    await resolveTaskEnvironmentRoot({
      workspaceId: input.request.workspace_id,
      environmentId: input.request.environment_id,
      rootPath: environment.root_path,
      storageBackendId: environment.storage_backend_id
    }),
    taskRootPath
  );
  const inputDir = path.resolve(taskDir, "inputs");
  const deltaPath = path.resolve(inputDir, "memory-delta.md");
  await fsPromises.mkdir(inputDir, { recursive: true });
  await fsPromises.writeFile(deltaPath, formatDelta(input.delta), "utf8");
  await ensureSandboxWritablePath({ rootPath: path.resolve(taskDir, "..", "..", ".."), targetPath: deltaPath });

  const createdAt = new Date().toISOString();
  const payload: TaskExecutionJob = {
    taskId,
    runId,
    workspaceId: input.request.workspace_id,
    environmentId: input.request.environment_id,
    triggerSource: "web",
    mode: "memory_synthesis"
  };

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO tasks (
        id, workspace_id, environment_id, title, status, source, initiator_user_id,
        default_timezone, max_steps_override, allow_waiting, is_hidden, task_root_path
      ) VALUES ($1, $2, $3, 'Refresh memory', 'queued', 'web', $4, 'UTC', 20, false, true, $5)`,
      [taskId, input.request.workspace_id, input.request.environment_id, input.request.initiator_user_id, taskRootPath]
    );
    await client.query(
      `INSERT INTO task_messages (
        task_id, role, content_json, message_metadata_json, author_user_id, created_at
      ) VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4, $5)`,
      [
        taskId,
        JSON.stringify({
          text: buildSynthesisPrompt(),
          tools: { webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false, computerUse: false }
        }),
        JSON.stringify(createTaskMessageMetadata(createdAt)),
        input.request.initiator_user_id,
        createdAt
      ]
    );
    await client.query(
      `INSERT INTO task_runs (id, task_id, attempt_no, run_kind)
       VALUES ($1, $2, 1, 'memory_synthesis')`,
      [runId, taskId]
    );
    await client.query(
      `UPDATE memory_synthesis_requests
          SET task_id = $2, source_through_at = $3, updated_at = now()
        WHERE id = $1`,
      [input.request.id, taskId, sourceThroughAt]
    );
    await insertTaskRunDispatchWithClient(client, {
      runId,
      taskId,
      workspaceId: input.request.workspace_id,
      environmentId: input.request.environment_id,
      payload,
      dispatchCategory: "background",
      priorityActorUserId: input.request.initiator_user_id
    });
  });
}

async function processNextRequest(input?: MemorySynthesisEvent): Promise<boolean> {
  const request = await claimNextRequest(input);
  if (!request) {
    return false;
  }

  try {
    const sourceAfter = request.source_through_at ?? await loadLatestCompletedCursor(request.environment_id);
    const delta = await loadDelta({ environmentId: request.environment_id, sourceAfter });
    if (delta.length === 0) {
      await query(
        `UPDATE memory_synthesis_requests
            SET status = 'succeeded', completed_at = now(), updated_at = now()
          WHERE id = $1`,
        [request.id]
      );
      return true;
    }
    await createSynthesisTask({ request, delta });
  } catch (error) {
    await query(
      `UPDATE memory_synthesis_requests
          SET status = 'failed', error_summary = $2, completed_at = now(), updated_at = now()
        WHERE id = $1`,
      [request.id, error instanceof Error ? error.message : String(error)]
    );
  }

  return true;
}

export async function triggerAutomaticMemorySynthesis(input: MemorySynthesisEvent): Promise<void> {
  await syncFinishedMemorySynthesisRequests();
  await queueAutomaticRequest(input);
  await processNextRequest(input);
}

function parseMemorySynthesisEvent(raw: string): MemorySynthesisEvent | null {
  try {
    const value = JSON.parse(raw) as Partial<MemorySynthesisEvent>;
    if (typeof value.workspaceId !== "string" || typeof value.environmentId !== "string") {
      return null;
    }
    return { workspaceId: value.workspaceId, environmentId: value.environmentId };
  } catch {
    return null;
  }
}

export function startMemorySynthesisEventListener(): { stop: () => Promise<void> } {
  const subscriber = redis.duplicate();
  const runningByProject = new Map<string, Promise<void>>();

  const trigger = (event: MemorySynthesisEvent) => {
    const key = `${event.workspaceId}:${event.environmentId}`;
    if (runningByProject.has(key)) {
      return;
    }
    const running = triggerAutomaticMemorySynthesis(event)
      .catch((error) => console.error("Memory synthesis event failed", error))
      .finally(() => runningByProject.delete(key));
    runningByProject.set(key, running);
  };

  subscriber.on("message", (_channel, raw) => {
    const event = parseMemorySynthesisEvent(raw);
    if (!event) {
      return;
    }
    trigger(event);
  });
  subscriber.on("error", (error) => console.error("Memory synthesis event listener failed", error));
  void subscriber.subscribe(MEMORY_SYNTHESIS_EVENT_CHANNEL)
    .catch((error) => console.error("Unable to subscribe to memory synthesis events", error));

  void syncFinishedMemorySynthesisRequests()
    .then(() => processNextRequest())
    .catch((error) => console.error("Memory synthesis startup recovery failed", error));

  return {
    stop: async () => {
      await Promise.all([...runningByProject.values()]);
      await subscriber.unsubscribe(MEMORY_SYNTHESIS_EVENT_CHANNEL).catch(() => undefined);
      await subscriber.quit();
    }
  };
}
