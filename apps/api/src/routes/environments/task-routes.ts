import type { FastifyInstance } from "fastify";
import { query } from "../../lib/db.js";
import { searchProjectTasks } from "../../services/task-search/query.js";
import { listProjectTasks } from "../../services/tasks/task-list.js";
import {
  emptyEnvironmentTrash,
  resolveTaskCleanupExpirationDays,
  runEnvironmentTaskCleanup
} from "../../services/tasks/task-cleanup.js";
import {
  environmentEntityPaths,
  environmentParams,
  environmentTaskCancelBody,
  environmentTaskCleanupBody,
  environmentTaskListQuery
} from "./shared.js";

export async function registerEnvironmentTaskRoutes(fastify: FastifyInstance): Promise<void> {
  for (const environmentPath of environmentEntityPaths) {
    fastify.get(
      `${environmentPath}/tasks`,
      { preHandler: fastify.authenticate },
      async (request) => {
        const params = environmentParams.parse(request.params);
        const queryInput = environmentTaskListQuery.parse(request.query);
        if (queryInput.query) {
          return searchProjectTasks({
            projectId: params.envId,
            actorUserId: request.user.id,
            filters: queryInput
          });
        }

        return listProjectTasks({
          projectId: params.envId,
          actorUserId: request.user.id,
          filters: {
            ...queryInput,
            sortBy: queryInput.sortBy === "relevance" ? "updated_at" : queryInput.sortBy
          }
        });
      }
    );

    fastify.post(
      `${environmentPath}/tasks/cancel`,
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        const params = environmentParams.parse(request.params);
        const body = environmentTaskCancelBody.parse(request.body ?? {});

        const envAccessRes = await query<{ id: string }>(
          `SELECT e.id
             FROM environments e
             JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
            WHERE e.id = $1
              AND wm.user_id = $2`,
          [params.envId, request.user.id]
        );
        if ((envAccessRes.rowCount ?? 0) === 0) {
          return reply.status(404).send({ error: "Project not found" });
        }

        const cancelledRes = await query<{ id: string }>(
          `WITH cancelled AS (
             UPDATE tasks t
                SET cancellation_requested = true,
                    resume_after_interrupt = false,
                    updated_at = now()
               FROM workspace_members wm
              WHERE t.environment_id = $1
                AND t.parent_task_id IS NULL
                AND wm.workspace_id = t.workspace_id
                AND wm.user_id = $2
                AND t.status IN ('queued', 'starting', 'running')
                AND t.cancellation_requested = false
                AND ($3::uuid[] IS NULL OR t.id = ANY($3::uuid[]))
              RETURNING t.id
           ),
           cancelled_schedules AS (
             UPDATE task_schedules ts
                SET schedule_state = 'cancelled',
                    next_run_at = NULL,
                    pending_run = false,
                    cancelled_at = now(),
                    updated_at = now()
               FROM cancelled c
              WHERE ts.task_id = c.id
              RETURNING ts.task_id
           )
           SELECT id FROM cancelled`,
          [params.envId, request.user.id, body.taskIds ?? null]
        );

        return {
          cancelledCount: cancelledRes.rowCount ?? 0
        };
      }
    );

    fastify.post(
      `${environmentPath}/tasks/cleanup`,
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        const params = environmentParams.parse(request.params);
        const body = environmentTaskCleanupBody.parse(request.body ?? {});

        const envRes = await query<{
          id: string;
          workspace_id: string;
          root_path: string;
          json_payload: Record<string, unknown>;
        }>(
          `SELECT e.id, e.workspace_id, e.root_path, e.json_payload
             FROM environments e
             JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
            WHERE e.id = $1
              AND wm.user_id = $2`,
          [params.envId, request.user.id]
        );

        if ((envRes.rowCount ?? 0) === 0) {
          return reply.status(404).send({ error: "Project not found" });
        }

        const environment = envRes.rows[0];
        const configuredExpirationDays = resolveTaskCleanupExpirationDays(environment.json_payload);
        const expirationDays = body.expirationDays ?? configuredExpirationDays;

        if (!expirationDays) {
          return reply.status(400).send({
            error:
              "Task cleanup is disabled for this project. Set a cleanup expiration in Project Settings first."
          });
        }

        const result = await runEnvironmentTaskCleanup({
          environmentId: environment.id,
          workspaceId: environment.workspace_id,
          rootPath: environment.root_path,
          expirationDays,
          limit: body.limit
        });

        return {
          executedAt: new Date().toISOString(),
          mode: body.expirationDays ? "override" : "setting",
          ...result
        };
      }
    );

    fastify.post(
      `${environmentPath}/tasks/empty-trash`,
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        const params = environmentParams.parse(request.params);

        const envRes = await query<{
          id: string;
          workspace_id: string;
          root_path: string;
        }>(
          `SELECT e.id, e.workspace_id, e.root_path
             FROM environments e
             JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
            WHERE e.id = $1
              AND wm.user_id = $2`,
          [params.envId, request.user.id]
        );

        if ((envRes.rowCount ?? 0) === 0) {
          return reply.status(404).send({ error: "Project not found" });
        }

        const environment = envRes.rows[0];
        const result = await emptyEnvironmentTrash({
          environmentId: environment.id,
          workspaceId: environment.workspace_id,
          rootPath: environment.root_path
        });

        return {
          ok: true,
          ...result
        };
      }
    );
  }
}
