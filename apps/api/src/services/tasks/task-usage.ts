import { toSafeInteger, type TaskUsageRun, type TaskUsageSummary } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import {
  mapTokenUsageTotals,
  tokenUsageAggregateSql,
  type TokenUsageAggregateRow
} from "../billing/token-usage-aggregate.js";
import { SPAWNED_TASKS_CTE } from "./spawned-tasks-sql.js";

const MAX_TASK_USAGE_RUNS = 200;

interface TaskUsageRunRow extends TokenUsageAggregateRow {
  run_id: string | null;
  run_kind: string | null;
  started_at: Date | string;
  models: string[] | null;
  run_count: string | number;
}

interface SpawnedUsageRow extends TokenUsageAggregateRow {
  task_count: string | number;
}

function mapRun(row: TaskUsageRunRow): TaskUsageRun {
  return {
    runId: row.run_id,
    runKind: row.run_kind,
    startedAt: new Date(row.started_at).toISOString(),
    models: row.models ?? [],
    ...mapTokenUsageTotals(row)
  };
}

export async function getTaskUsageSummary(taskId: string): Promise<TaskUsageSummary> {
  const [totalsResult, spawnedResult, runsResult] = await Promise.all([
    query<TokenUsageAggregateRow>(
      `${SPAWNED_TASKS_CTE}
       SELECT ${tokenUsageAggregateSql("e")}
         FROM user_token_usage_events e
        WHERE (e.task_id = $1 OR e.task_id IN (SELECT id FROM spawned_tasks))
          AND e.usage_event_kind = 'model_response'`,
      [taskId]
    ),
    query<SpawnedUsageRow>(
      `${SPAWNED_TASKS_CTE}
       SELECT COUNT(DISTINCT e.task_id)::text AS task_count,
              ${tokenUsageAggregateSql("e")}
         FROM user_token_usage_events e
        WHERE e.task_id IN (SELECT id FROM spawned_tasks)
          AND e.usage_event_kind = 'model_response'`,
      [taskId]
    ),
    query<TaskUsageRunRow>(
      `SELECT e.run_id::text AS run_id,
              r.run_kind,
              COALESCE(r.started_at, MIN(e.occurred_at)) AS started_at,
              array_agg(DISTINCT e.model ORDER BY e.model) AS models,
              COUNT(*) OVER ()::text AS run_count,
              ${tokenUsageAggregateSql("e")}
         FROM user_token_usage_events e
    LEFT JOIN task_runs r ON r.id = e.run_id
        WHERE e.task_id = $1
          AND e.usage_event_kind = 'model_response'
        GROUP BY e.run_id, r.run_kind, r.started_at
        ORDER BY started_at DESC
        LIMIT ${MAX_TASK_USAGE_RUNS}`,
      [taskId]
    )
  ]);

  return {
    totals: mapTokenUsageTotals(totalsResult.rows[0]),
    spawned: {
      ...mapTokenUsageTotals(spawnedResult.rows[0]),
      taskCount: toSafeInteger(spawnedResult.rows[0]?.task_count)
    },
    runs: runsResult.rows.map(mapRun),
    runCount: toSafeInteger(runsResult.rows[0]?.run_count)
  };
}
