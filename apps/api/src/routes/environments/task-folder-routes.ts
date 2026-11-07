import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { deleteProjectFolder, lockProjectMapHierarchy, recordProjectMapChange, type ProjectMapDb } from "@meowbert/shared";
import { pool, query, withTransaction } from "../../lib/db.js";
import { describeFolder, describeMapItems } from "../../services/project-map/map-change-summaries.js";
import { environmentEntityPaths, environmentParams } from "./shared.js";

const folderParams = z.object({
  folderId: z.string().uuid()
});

const taskFolderBody = z.object({
  name: z.string().trim().min(1).max(120),
  parentFolderId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().finite().optional()
}).strict();

const taskFolderPatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().finite().optional()
}).strict();

const taskMoveBody = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(500),
  folderId: z.string().uuid().nullable()
}).strict();

interface ProjectAccessRow {
  workspace_id: string;
}

interface TaskFolderRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  parent_folder_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  direct_task_count?: number | string;
  child_folder_count?: number | string;
}

function serializeTaskFolder(row: TaskFolderRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.environment_id,
    environmentId: row.environment_id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
    sortOrder: Number(row.sort_order),
    directTaskCount: Number(row.direct_task_count ?? 0),
    childFolderCount: Number(row.child_folder_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getProjectAccess(environmentId: string, userId: string): Promise<ProjectAccessRow | null> {
  const accessRes = await query<ProjectAccessRow>(
    `SELECT e.workspace_id
       FROM environments e
       JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE e.id = $1
        AND wm.user_id = $2`,
    [environmentId, userId]
  );

  return accessRes.rows[0] ?? null;
}

async function assertParentFolder(
  parentFolderId: string | null | undefined,
  environmentId: string,
  db: ProjectMapDb = { query }
): Promise<void> {
  if (!parentFolderId) {
    return;
  }

  const parentRes = await db.query<{ id: string }>(
    `SELECT id
       FROM task_folders
      WHERE id = $1
        AND environment_id = $2`,
    [parentFolderId, environmentId]
  );

  if ((parentRes.rowCount ?? 0) === 0) {
    throw new Error("Folder not found");
  }
}

async function readFolderForUser(folderId: string, userId: string): Promise<TaskFolderRow | null> {
  const folderRes = await query<TaskFolderRow>(
    `SELECT tf.id,
            tf.workspace_id,
            tf.environment_id,
            tf.parent_folder_id,
            tf.name,
            tf.sort_order,
            tf.created_at,
            tf.updated_at
       FROM task_folders tf
       JOIN workspace_members wm ON wm.workspace_id = tf.workspace_id
      WHERE tf.id = $1
        AND wm.user_id = $2`,
    [folderId, userId]
  );

  return folderRes.rows[0] ?? null;
}

async function isDescendantFolder(db: ProjectMapDb, folderId: string, candidateParentId: string): Promise<boolean> {
  const descendantRes = await db.query<{ id: string }>(
    `WITH RECURSIVE descendants AS (
       SELECT id
         FROM task_folders
        WHERE parent_folder_id = $1
       UNION
       SELECT child.id
         FROM task_folders child
         JOIN descendants d ON d.id = child.parent_folder_id
     )
     SELECT id
       FROM descendants
      WHERE id = $2
      LIMIT 1`,
    [folderId, candidateParentId]
  );

  return (descendantRes.rowCount ?? 0) > 0;
}

async function handlePatchTaskFolder(request: FastifyRequest, reply: FastifyReply) {
  const params = folderParams.parse(request.params);
  const body = taskFolderPatchBody.parse(request.body ?? {});
  const folder = await readFolderForUser(params.folderId, request.user.id);
  if (!folder) {
    return reply.status(404).send({ error: "Folder not found" });
  }

  return withTransaction(async (client) => {
    await lockProjectMapHierarchy(client, folder.environment_id);
    if (body.parentFolderId !== undefined) {
      if (body.parentFolderId === folder.id) {
        return reply.status(409).send({ error: "A folder cannot be moved into itself." });
      }
      await assertParentFolder(body.parentFolderId, folder.environment_id, client);
      if (body.parentFolderId && await isDescendantFolder(client, folder.id, body.parentFolderId)) {
        return reply.status(409).send({ error: "A folder cannot be moved into its own child." });
      }
    }

    const updatedRes = await client.query<TaskFolderRow>(
      `UPDATE task_folders
          SET name = COALESCE($2, name),
              parent_folder_id = CASE WHEN $3 THEN $4::uuid ELSE parent_folder_id END,
              sort_order = COALESCE($5, sort_order),
              updated_at = now()
        WHERE id = $1
        RETURNING id,
                  workspace_id,
                  environment_id,
                  parent_folder_id,
                  name,
                  sort_order,
                  created_at,
                  updated_at`,
      [
        folder.id,
        body.name ?? null,
        Object.hasOwn(body, "parentFolderId"),
        body.parentFolderId ?? null,
        body.sortOrder ?? null
      ]
    );

    const summary = [
      body.name !== undefined && body.name !== folder.name ? `renamed folder "${folder.name}" to "${body.name}" [${folder.id}]` : "",
      body.parentFolderId !== undefined && body.parentFolderId !== folder.parent_folder_id
        ? `moved folder "${folder.name}" [${folder.id}] into ${await describeFolder(client, body.parentFolderId)}` : ""
    ].filter(Boolean).join(" and ");
    if (summary) {
      await recordProjectMapChange(client, { environmentId: folder.environment_id, actorUserId: request.user.id, summary });
    }

    return {
      folder: serializeTaskFolder(updatedRes.rows[0])
    };
  });
}

async function handleDeleteTaskFolder(request: FastifyRequest, reply: FastifyReply) {
  const params = folderParams.parse(request.params);
  const folder = await readFolderForUser(params.folderId, request.user.id);
  if (!folder) {
    return reply.status(404).send({ error: "Folder not found" });
  }

  await withTransaction(async (client) => {
    await deleteProjectFolder(client, folder.environment_id, folder.id);
    await recordProjectMapChange(client, {
      environmentId: folder.environment_id,
      actorUserId: request.user.id,
      summary: `deleted folder "${folder.name}" [${folder.id}]; its contents moved up a level`
    });
  });

  return { ok: true };
}

export async function registerEnvironmentTaskFolderRoutes(fastify: FastifyInstance): Promise<void> {
  for (const environmentPath of environmentEntityPaths) {
    fastify.get(
      `${environmentPath}/task-folders`,
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        const params = environmentParams.parse(request.params);
        const access = await getProjectAccess(params.envId, request.user.id);
        if (!access) {
          return reply.status(404).send({ error: "Project not found" });
        }

        const foldersRes = await query<TaskFolderRow>(
          `SELECT tf.id,
                  tf.workspace_id,
                  tf.environment_id,
                  tf.parent_folder_id,
                  tf.name,
                  tf.sort_order,
                  tf.created_at,
                  tf.updated_at,
                  COALESCE(task_counts.direct_task_count, 0)::int AS direct_task_count,
                  COALESCE(child_counts.child_folder_count, 0)::int AS child_folder_count
             FROM task_folders tf
        LEFT JOIN (
                  SELECT folder_id, COUNT(*)::int AS direct_task_count
                    FROM tasks
                   WHERE environment_id = $1
                     AND parent_task_id IS NULL
                     AND workflow_parent_task_id IS NULL
                     AND is_incognito = false
                     AND trashed_at IS NULL
                     AND folder_id IS NOT NULL
                GROUP BY folder_id
                ) task_counts ON task_counts.folder_id = tf.id
        LEFT JOIN (
                  SELECT parent_folder_id, COUNT(*)::int AS child_folder_count
                    FROM task_folders
                   WHERE environment_id = $1
                     AND parent_folder_id IS NOT NULL
                GROUP BY parent_folder_id
                ) child_counts ON child_counts.parent_folder_id = tf.id
            WHERE tf.environment_id = $1
            ORDER BY tf.parent_folder_id NULLS FIRST, tf.sort_order ASC, tf.created_at ASC, tf.id ASC`,
          [params.envId]
        );

        return {
          folders: foldersRes.rows.map(serializeTaskFolder)
        };
      }
    );

    fastify.post(
      `${environmentPath}/task-folders`,
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        const params = environmentParams.parse(request.params);
        const body = taskFolderBody.parse(request.body ?? {});
        const access = await getProjectAccess(params.envId, request.user.id);
        if (!access) {
          return reply.status(404).send({ error: "Project not found" });
        }
        await assertParentFolder(body.parentFolderId, params.envId);

        const createdRes = await query<TaskFolderRow>(
          `INSERT INTO task_folders (
             workspace_id,
             environment_id,
             parent_folder_id,
             name,
             sort_order
           )
           VALUES (
             $1,
             $2,
             $3,
             $4,
             COALESCE(
               $5,
               (
                 SELECT COALESCE(MAX(sort_order), -1) + 1
                   FROM task_folders
                  WHERE environment_id = $2
                    AND parent_folder_id IS NOT DISTINCT FROM $3::uuid
               )
             )
           )
           RETURNING id,
                     workspace_id,
                     environment_id,
                     parent_folder_id,
                     name,
                     sort_order,
                     created_at,
                     updated_at`,
          [
            access.workspace_id,
            params.envId,
            body.parentFolderId ?? null,
            body.name,
            body.sortOrder ?? null
          ]
        );

        const created = createdRes.rows[0];
        await recordProjectMapChange(pool, {
          environmentId: params.envId,
          actorUserId: request.user.id,
          summary: `created folder "${created.name}" [${created.id}] in ${await describeFolder(pool, created.parent_folder_id)}`
        });

        return reply.status(201).send({
          folder: serializeTaskFolder(created)
        });
      }
    );

    fastify.post(
      `${environmentPath}/tasks/move`,
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        const params = environmentParams.parse(request.params);
        const body = taskMoveBody.parse(request.body ?? {});
        const access = await getProjectAccess(params.envId, request.user.id);
        if (!access) {
          return reply.status(404).send({ error: "Project not found" });
        }
        await assertParentFolder(body.folderId, params.envId);

        const movedRes = await query<{ id: string }>(
          `WITH selected AS (
             SELECT id, ordinality
               FROM unnest($2::uuid[]) WITH ORDINALITY AS input(id, ordinality)
           ),
           base_order AS (
             SELECT COALESCE(MAX(folder_sort_order), -1) AS value
               FROM tasks
              WHERE environment_id = $1
                AND folder_id IS NOT DISTINCT FROM $3::uuid
           )
           UPDATE tasks t
              SET folder_id = $3,
                  folder_sort_order = base_order.value + selected.ordinality,
                  updated_at = now()
             FROM selected, base_order
            WHERE t.id = selected.id
              AND t.environment_id = $1
              AND t.parent_task_id IS NULL
              AND t.workflow_parent_task_id IS NULL
          RETURNING t.id`,
          [params.envId, body.taskIds, body.folderId]
        );

        if (movedRes.rowCount) {
          await recordProjectMapChange(pool, {
            environmentId: params.envId,
            actorUserId: request.user.id,
            summary: `moved ${await describeMapItems(pool, movedRes.rows.map((row) => row.id))} into ${await describeFolder(pool, body.folderId)}`
          });
        }

        return {
          movedCount: movedRes.rowCount ?? 0
        };
      }
    );
  }

  fastify.patch("/api/task-folders/:folderId", { preHandler: fastify.authenticate }, handlePatchTaskFolder);
  fastify.delete("/api/task-folders/:folderId", { preHandler: fastify.authenticate }, handleDeleteTaskFolder);
}
