import fsPromises from "node:fs/promises";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  DEFAULT_MEMORY_ENABLED,
  createDefaultProjectSuggestedActions,
  getWorkspaceSuggestedActionsEnabled
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { assertWorkspaceMember } from "../../services/workspaces/workspace-access.js";
import {
  ensureProjectMemoryFiles,
  ensureWorkspaceMemoryFiles,
  loadProjectSuggestedActions
} from "../../services/workspaces/workspace-memory.js";
import { ensureWorkspaceStorageRoot } from "../../services/workspaces/workspace-storage.js";
import { publishMemorySynthesisEvent } from "../../services/workspaces/memory-synthesis-events.js";
import { workspaceParamsSchema } from "./shared.js";

const memoryQuerySchema = z.object({ projectId: z.string().uuid().optional() });
const refreshMemoryBodySchema = z.object({ projectId: z.string().uuid() });
const projectParamsSchema = z.object({
  wsId: z.string().uuid(),
  projectId: z.string().uuid()
});

async function loadProjectName(workspaceId: string, projectId: string): Promise<string> {
  const projectRes = await query<{ name: string }>(
    `SELECT name
       FROM environments
      WHERE id = $1
        AND workspace_id = $2`,
    [projectId, workspaceId]
  );
  if ((projectRes.rowCount ?? 0) === 0) {
    throw new Error("Project not found in this workspace");
  }
  return projectRes.rows[0].name;
}

export async function registerWorkspaceMemoryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/workspaces/:wsId/memory", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const input = memoryQuerySchema.parse(request.query);
    await assertWorkspaceMember(params.wsId, request.user.id);

    const workspaceRes = await query<{
      id: string;
      root_path: string;
      storage_backend_id: string;
      memory_enabled: boolean;
      model_defaults_json: Record<string, unknown> | null;
    }>(
      `SELECT w.id,
              w.root_path,
              w.storage_backend_id,
              COALESCE(ws.memory_enabled, ${DEFAULT_MEMORY_ENABLED}) AS memory_enabled,
              ws.model_defaults_json
         FROM workspaces w
         LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
        WHERE w.id = $1`,
      [params.wsId]
    );
    const workspace = workspaceRes.rows[0];
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    if (!workspace.memory_enabled) {
      return {
        enabled: false,
        workspace: null,
        project: null,
        actions: createDefaultProjectSuggestedActions(),
        latestRefresh: null,
        recentRefreshes: []
      };
    }

    const workspaceRoot = await ensureWorkspaceStorageRoot(workspace);
    const workspaceMemory = await ensureWorkspaceMemoryFiles(workspaceRoot);
    const projectName = input.projectId ? await loadProjectName(params.wsId, input.projectId) : null;
    const projectMemory = input.projectId
      ? await ensureProjectMemoryFiles({ workspaceRoot, projectId: input.projectId, projectName })
      : null;
    const suggestedActionsEnabled = getWorkspaceSuggestedActionsEnabled(workspace.model_defaults_json);
    const projectActions = input.projectId && suggestedActionsEnabled
      ? await loadProjectSuggestedActions({ workspaceRoot, projectId: input.projectId })
      : createDefaultProjectSuggestedActions();

    const recentRefreshes = input.projectId
      ? await query<{
        id: string;
        status: "queued" | "running" | "succeeded" | "failed";
        task_id: string | null;
        created_at: string;
        completed_at: string | null;
        error_summary: string | null;
      }>(
        `SELECT id, status, task_id, created_at, completed_at, error_summary
           FROM memory_synthesis_requests
          WHERE workspace_id = $1
            AND environment_id = $2
          ORDER BY created_at DESC
          LIMIT 10`,
        [params.wsId, input.projectId]
      )
      : null;

    return {
      enabled: true,
      suggestedActionsEnabled,
      workspace: {
        path: workspaceMemory.mainFilePath,
        content: await fsPromises.readFile(workspaceMemory.mainFilePath, "utf8")
      },
      project: projectMemory
        ? {
          path: projectMemory.mainFilePath,
          content: await fsPromises.readFile(projectMemory.mainFilePath, "utf8")
        }
        : null,
      actions: projectActions,
      latestRefresh: recentRefreshes?.rows[0] ?? null,
      recentRefreshes: recentRefreshes?.rows ?? []
    };
  });

  fastify.get("/api/workspaces/:wsId/projects/:projectId/suggested-actions", { preHandler: fastify.authenticate }, async (request) => {
    const params = projectParamsSchema.parse(request.params);
    await assertWorkspaceMember(params.wsId, request.user.id);
    await loadProjectName(params.wsId, params.projectId);

    const workspaceRes = await query<{
      id: string;
      root_path: string;
      storage_backend_id: string;
      memory_enabled: boolean;
      model_defaults_json: Record<string, unknown> | null;
    }>(
      `SELECT w.id,
              w.root_path,
              w.storage_backend_id,
              COALESCE(ws.memory_enabled, ${DEFAULT_MEMORY_ENABLED}) AS memory_enabled,
              ws.model_defaults_json
         FROM workspaces w
         LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
        WHERE w.id = $1`,
      [params.wsId]
    );
    const workspace = workspaceRes.rows[0];
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const suggestedActionsEnabled = getWorkspaceSuggestedActionsEnabled(workspace.model_defaults_json);
    if (!workspace.memory_enabled || !suggestedActionsEnabled) {
      return {
        enabled: suggestedActionsEnabled && workspace.memory_enabled,
        actions: createDefaultProjectSuggestedActions()
      };
    }

    const workspaceRoot = await ensureWorkspaceStorageRoot(workspace);
    await ensureProjectMemoryFiles({
      workspaceRoot,
      projectId: params.projectId
    });
    const actions = await loadProjectSuggestedActions({
      workspaceRoot,
      projectId: params.projectId
    });

    return {
      enabled: true,
      actions
    };
  });

  fastify.post("/api/workspaces/:wsId/memory/refresh", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const body = refreshMemoryBodySchema.parse(request.body);
    await assertWorkspaceMember(params.wsId, request.user.id);
    await loadProjectName(params.wsId, body.projectId);
    const settingsRes = await query<{ memory_enabled: boolean }>(
      `SELECT COALESCE(memory_enabled, ${DEFAULT_MEMORY_ENABLED}) AS memory_enabled
         FROM workspace_settings
        WHERE workspace_id = $1`,
      [params.wsId]
    );
    if ((settingsRes.rows[0]?.memory_enabled ?? DEFAULT_MEMORY_ENABLED) !== true) {
      throw new Error("Workspace Memory is disabled");
    }

    const inserted = await query<{ id: string; status: "queued" }>(
      `INSERT INTO memory_synthesis_requests (workspace_id, environment_id, initiator_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id, status`,
      [params.wsId, body.projectId, request.user.id]
    );
    if ((inserted.rowCount ?? 0) > 0) {
      await publishMemorySynthesisEvent({ workspaceId: params.wsId, environmentId: body.projectId });
      return { request: inserted.rows[0], queued: true };
    }

    const existing = await query<{ id: string; status: "queued" | "running" }>(
      `SELECT id, status
         FROM memory_synthesis_requests
        WHERE environment_id = $1
          AND status IN ('queued', 'running')
        ORDER BY created_at DESC
        LIMIT 1`,
      [body.projectId]
    );
    return { request: existing.rows[0] ?? null, queued: false };
  });
}
