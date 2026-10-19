import {
  toSafeInteger,
  type WastedTurnKind,
  type WastedTurnTaskBreakdown,
  type WastedTurnsReport
} from "@meowbert/shared";
import { query } from "../../../lib/db.js";
import { SPAWNED_TASKS_CTE } from "../../tasks/spawned-tasks-sql.js";
import { classifyWastedTurn, WASTED_TURN_LOG_STAGES } from "./wasted-turn-kind.js";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_TASK_BREAKDOWN_ROWS = 20;

const SCOPE_CTE = `${SPAWNED_TASKS_CTE},
  scope(id) AS (SELECT $1::uuid UNION SELECT id FROM spawned_tasks)`;

interface WastedTurnRow {
  task_id: string;
  title: string | null;
  payload_json: Record<string, unknown>;
  weighted_tokens: string | number | null;
}

interface ScopeTotalsRow {
  task_count: string | number;
  turns: string | number;
  weighted_tokens: string | number;
  diagnostic_count: string | number;
}

// Accepts a task URL or a bare id. A URL can carry other ids (workspace, project), so the
// last id that names a task wins.
export async function resolveTaskIdFromTarget(target: string): Promise<{ id: string; title: string | null }> {
  const candidates = [...target.matchAll(UUID_PATTERN)].map((match) => match[0].toLowerCase()).reverse();
  if (candidates.length === 0) throw new Error("No task id found in that URL.");
  const result = await query<{ id: string; title: string | null }>(
    `SELECT id::text AS id, title FROM tasks WHERE id = ANY($1::uuid[])`,
    [candidates]
  );
  const found = candidates.map((id) => result.rows.find((row) => row.id === id)).find(Boolean);
  if (!found) throw new Error("Task not found.");
  return found;
}

// Each diagnostic log is written after its turn's usage row, so the turn's cost is the
// latest usage row of the same task at or before the log.
async function loadWastedTurnRows(taskId: string): Promise<WastedTurnRow[]> {
  const result = await query<WastedTurnRow>(
    `${SCOPE_CTE}
     SELECT te.task_id::text AS task_id, t.title, te.payload_json, u.weighted_tokens
       FROM task_events te
       JOIN tasks t ON t.id = te.task_id
  LEFT JOIN LATERAL (
            SELECT e.weighted_tokens
              FROM user_token_usage_events e
             WHERE e.task_id = te.task_id
               AND e.usage_event_kind = 'model_response'
               AND e.occurred_at <= te.created_at
             ORDER BY e.occurred_at DESC
             LIMIT 1
          ) u ON true
      WHERE te.task_id IN (SELECT id FROM scope)
        AND te.type = 'log'
        AND te.payload_json->>'stage' = ANY($2::text[])`,
    [taskId, [...WASTED_TURN_LOG_STAGES]]
  );
  return result.rows;
}

async function loadScopeTotals(taskId: string): Promise<ScopeTotalsRow | undefined> {
  const result = await query<ScopeTotalsRow>(
    `${SCOPE_CTE}
     SELECT (SELECT COUNT(*) FROM scope)::text AS task_count,
            (SELECT COUNT(*) FROM user_token_usage_events e
              WHERE e.task_id IN (SELECT id FROM scope) AND e.usage_event_kind = 'model_response')::text AS turns,
            (SELECT COALESCE(SUM(e.weighted_tokens), 0) FROM user_token_usage_events e
              WHERE e.task_id IN (SELECT id FROM scope) AND e.usage_event_kind = 'model_response')::text AS weighted_tokens,
            (SELECT COUNT(*) FROM task_events te
              WHERE te.task_id IN (SELECT id FROM scope) AND te.type = 'log'
                AND te.payload_json->>'stage' LIKE 'startup.%')::text AS diagnostic_count`,
    [taskId]
  );
  return result.rows[0];
}

function summarizeWastedTurns(rows: WastedTurnRow[]) {
  const byKind = new Map<WastedTurnKind, { turns: number; weightedTokens: number }>();
  const byTask = new Map<string, WastedTurnTaskBreakdown>();
  let weightedTokens = 0;
  let unmeteredTurns = 0;
  for (const row of rows) {
    const kind = classifyWastedTurn(row.payload_json);
    const cost = row.weighted_tokens === null ? 0 : toSafeInteger(row.weighted_tokens);
    if (row.weighted_tokens === null) unmeteredTurns += 1;
    weightedTokens += cost;
    const kindTotals = byKind.get(kind) ?? { turns: 0, weightedTokens: 0 };
    byKind.set(kind, { turns: kindTotals.turns + 1, weightedTokens: kindTotals.weightedTokens + cost });
    const taskTotals = byTask.get(row.task_id) ?? { taskId: row.task_id, title: row.title, turns: 0, weightedTokens: 0 };
    byTask.set(row.task_id, { ...taskTotals, turns: taskTotals.turns + 1, weightedTokens: taskTotals.weightedTokens + cost });
  }
  return {
    wasted: { turns: rows.length, weightedTokens, unmeteredTurns },
    byKind: [...byKind].map(([kind, totals]) => ({ kind, ...totals })).sort((a, b) => b.turns - a.turns),
    byTask: [...byTask.values()].sort((a, b) => b.weightedTokens - a.weightedTokens).slice(0, MAX_TASK_BREAKDOWN_ROWS)
  };
}

export async function buildWastedTurnsReport(target: string): Promise<WastedTurnsReport> {
  const task = await resolveTaskIdFromTarget(target);
  const [rows, totals] = await Promise.all([loadWastedTurnRows(task.id), loadScopeTotals(task.id)]);
  return {
    taskId: task.id,
    title: task.title,
    hasTurnDiagnostics: toSafeInteger(totals?.diagnostic_count) > 0,
    scopeTaskCount: toSafeInteger(totals?.task_count),
    allTurns: { turns: toSafeInteger(totals?.turns), weightedTokens: toSafeInteger(totals?.weighted_tokens) },
    ...summarizeWastedTurns(rows)
  };
}
