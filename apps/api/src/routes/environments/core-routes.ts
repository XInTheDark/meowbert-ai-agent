import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../../lib/db.js";
import { assertWorkspaceMember } from "../../services/workspaces/workspace-access.js";
import { createEnvironment } from "../../services/environments/environment-creation.js";
import { personalityDefaultId, personalityOptions } from "../../services/environments/personality-options.js";
import {
  environmentEntityPaths,
  environmentParams,
  jsonObjectSchema,
  workspaceEnvironmentCollectionPaths,
  workspaceParams
} from "./shared.js";

export async function registerEnvironmentCoreRoutes(fastify: FastifyInstance): Promise<void> {
  for (const workspaceCollectionPath of workspaceEnvironmentCollectionPaths) {
    fastify.get(
      workspaceCollectionPath,
      { preHandler: fastify.authenticate },
      async (request) => {
        const params = workspaceParams.parse(request.params);
        await assertWorkspaceMember(params.wsId, request.user.id);

        const result = await query<{
          id: string;
          workspace_id: string;
          name: string;
          status: string;
          root_path: string;
          json_payload: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT e.id,
                  e.workspace_id,
                  e.name,
                  e.status,
                  e.root_path,
                  e.json_payload,
                  e.created_at,
                  GREATEST(e.updated_at, COALESCE(task_activity.latest_task_updated_at, e.updated_at)) AS updated_at
             FROM environments e
             LEFT JOIN LATERAL (
               SELECT MAX(t.updated_at) AS latest_task_updated_at
                 FROM tasks t
                WHERE t.environment_id = e.id
             ) AS task_activity ON true
            WHERE e.workspace_id = $1
            ORDER BY updated_at DESC`,
          [params.wsId]
        );

        return { items: result.rows };
      }
    );

    fastify.post(
      workspaceCollectionPath,
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        const params = workspaceParams.parse(request.params);
        await assertWorkspaceMember(params.wsId, request.user.id);

        const body = z.object({ name: z.string().min(1).max(120) }).parse(request.body);

        const environment = await createEnvironment({
          workspaceId: params.wsId,
          name: body.name,
          createdByUserId: request.user.id
        });

        return reply.status(201).send(environment);
      }
    );
  }

  for (const environmentPath of environmentEntityPaths) {
    fastify.get(environmentPath, { preHandler: fastify.authenticate }, async (request) => {
      const params = environmentParams.parse(request.params);

      const envRes = await query<{
        id: string;
        workspace_id: string;
        name: string;
        status: string;
        root_path: string;
        json_payload: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT e.id,
                e.workspace_id,
                e.name,
                e.status,
                e.root_path,
                e.json_payload,
                e.created_at,
                GREATEST(e.updated_at, COALESCE(task_activity.latest_task_updated_at, e.updated_at)) AS updated_at
           FROM environments e
           LEFT JOIN LATERAL (
             SELECT MAX(t.updated_at) AS latest_task_updated_at
               FROM tasks t
              WHERE t.environment_id = e.id
           ) AS task_activity ON true
           JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
          WHERE e.id = $1 AND wm.user_id = $2`,
        [params.envId, request.user.id]
      );

      if ((envRes.rowCount ?? 0) === 0) {
        return { error: "Project not found" };
      }

      return envRes.rows[0];
    });

    fastify.get(`${environmentPath}/personalities`, { preHandler: fastify.authenticate }, async (request) => {
      const params = environmentParams.parse(request.params);

      const envRes = await query<{ workspace_id: string; root_path: string }>(
        `SELECT workspace_id, root_path FROM environments WHERE id = $1`,
        [params.envId]
      );

      if ((envRes.rowCount ?? 0) === 0) {
        return { error: "Project not found" };
      }

      await assertWorkspaceMember(envRes.rows[0].workspace_id, request.user.id);

      return {
        items: personalityOptions,
        defaultId: personalityDefaultId
      };
    });

    fastify.patch(environmentPath, { preHandler: fastify.authenticate }, async (request) => {
      const params = environmentParams.parse(request.params);
      const body = z
        .object({
          name: z.string().min(1).max(120).optional(),
          status: z.enum(["active", "archived", "error"]).optional(),
          jsonPayload: jsonObjectSchema.optional()
        })
        .parse(request.body);

      const envRes = await query<{ workspace_id: string; root_path: string }>(
        `SELECT workspace_id, root_path FROM environments WHERE id = $1`,
        [params.envId]
      );

      if ((envRes.rowCount ?? 0) === 0) {
        throw new Error("Project not found");
      }

      await assertWorkspaceMember(envRes.rows[0].workspace_id, request.user.id);

      await query(
        `UPDATE environments
            SET name = COALESCE($2, name),
                status = COALESCE($3, status),
                json_payload = COALESCE($4::jsonb, json_payload),
                updated_at = now()
          WHERE id = $1`,
        [params.envId, body.name ?? null, body.status ?? null, body.jsonPayload ? JSON.stringify(body.jsonPayload) : null]
      );

      return { ok: true };
    });

    fastify.post(
      `${environmentPath}/archive`,
      { preHandler: fastify.authenticate },
      async (request) => {
        const params = environmentParams.parse(request.params);

        const envRes = await query<{ workspace_id: string }>(
          `SELECT workspace_id FROM environments WHERE id = $1`,
          [params.envId]
        );

        if ((envRes.rowCount ?? 0) === 0) {
          throw new Error("Project not found");
        }

        await assertWorkspaceMember(envRes.rows[0].workspace_id, request.user.id);
        await query(`UPDATE environments SET status = 'archived', updated_at = now() WHERE id = $1`, [params.envId]);

        return { ok: true };
      }
    );
  }
}
