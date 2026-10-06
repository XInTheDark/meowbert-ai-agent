import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DEFAULT_MEMORY_ENABLED,
  DEFAULT_WORKSPACE_LIMIT,
  normalizeTaskPagePreferences,
  resolveEffectiveWorkspaceLimit,
  setSandboxNetworkEnabledOverride,
  setWorkspaceDefaultToolset,
  setWorkspacePersonalityId,
  setWorkspaceMemorySynthesisEnabled,
  setWorkspaceSuggestedActionsEnabled,
  setWorkspaceSystemPrompt,
  setWorkspaceThoughtPersistenceEnabled
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { isSuperAdmin } from "../../services/admin/admin-settings.js";
import { assertWorkspaceMember } from "../../services/workspaces/workspace-access.js";
import { canUseAsWorkspaceDefaultAgent } from "../../services/workspaces/workspace-default-agent.js";
import { ensureWorkspaceMemoryFiles } from "../../services/workspaces/workspace-memory.js";
import { getDefaultWorkspaceStorageBackendId } from "../../services/storage/default-backend.js";
import { ensureWorkspaceStorageRoot } from "../../services/workspaces/workspace-storage.js";
import { ensureUserHasWorkspace } from "../../services/workspaces/user-workspace.js";
import {
  createWorkspaceSchema,
  createWorkspaceSlug,
  formatWorkspaceSettingsResponse,
  isWorkspaceOwner,
  updateWorkspaceSchema,
  workspaceBootstrapQuerySchema,
  workspaceParamsSchema,
  workspaceSettingsPatchSchema,
  WorkspaceLimitReachedError,
  type WorkspaceListRow
} from "./shared.js";

type WorkspaceSettingsPatch = z.infer<typeof workspaceSettingsPatchSchema>;

async function createWorkspaceForUser(userId: string, name: string): Promise<{ id: string; name: string; iconKey: string }> {
  const slug = createWorkspaceSlug(name);

  return withTransaction(async (client) => {
    const userResult = await client.query<{
      workspace_limit: number | null;
      plan_workspace_limit: number | null;
      is_super_admin: boolean;
    }>(
      `SELECT u.workspace_limit,
              u.is_super_admin,
              plan_limits.workspace_limit AS plan_workspace_limit
         FROM users u
          LEFT JOIN LATERAL (
            SELECT MAX(sp.workspace_limit)::int AS workspace_limit
              FROM subscription_plans sp
             WHERE sp.is_active = true
               AND (
                 sp.is_default = true
                 OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = u.id)
               )
          ) AS plan_limits ON true
        WHERE u.id = $1`,
      [userId]
    );
    const user = userResult.rows[0];

    if (!user.is_super_admin) {
      const effectiveWorkspaceLimit = resolveEffectiveWorkspaceLimit({
        defaultWorkspaceLimit: DEFAULT_WORKSPACE_LIMIT,
        workspaceLimit: user.workspace_limit,
        subscriptionPlanWorkspaceLimit: user.plan_workspace_limit
      });
      const countResult = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM workspace_members
          WHERE user_id = $1
            AND role = 'owner'`,
        [userId]
      );
      if (Number(countResult.rows[0].count) >= effectiveWorkspaceLimit) {
        throw new WorkspaceLimitReachedError();
      }
    }

    const defaultStorageBackendId = await getDefaultWorkspaceStorageBackendId(client);

    const wsRes = await client.query<{ id: string; icon_key: string }>(
      `INSERT INTO workspaces (name, slug, storage_backend_id)
       VALUES ($1, $2, $3)
       RETURNING id, icon_key`,
      [name, slug, defaultStorageBackendId]
    );
    const wsId = wsRes.rows[0].id;

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [wsId, userId]
    );

    await client.query(
      `INSERT INTO workspace_settings (workspace_id, memory_enabled)
       VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [wsId, DEFAULT_MEMORY_ENABLED]
    );

    return { id: wsId, name, iconKey: wsRes.rows[0].icon_key };
  });
}

function hasOwnerManagedWorkspaceSettings(body: WorkspaceSettingsPatch): boolean {
  return body.modelRequestTimeoutMs !== undefined
    || body.shellToolMaxTimeoutMs !== undefined
    || body.mcpTimeoutMs !== undefined
    || body.newMessageOrganizationEnabled !== undefined
    || body.projectMasterEnabled !== undefined
    || body.defaultAgentId !== undefined
    || body.nativeCompactionEnabled !== undefined
    || body.sendMetadataToModel !== undefined
    || body.claudeCacheKeepalive !== undefined
    || body.codeModeEnabled !== undefined
    || body.systemPrompt !== undefined
    || body.personalityId !== undefined
    || body.sandboxNetworkEnabled !== undefined
    || body.defaultToolset !== undefined
    || body.memoryEnabled !== undefined
    || body.memorySynthesisEnabled !== undefined
    || body.suggestedActionsEnabled !== undefined
    || body.thoughtPersistenceEnabled !== undefined;
}

function applyWorkspaceModelDefaultsPatch(
  currentModelDefaults: Record<string, unknown>,
  body: WorkspaceSettingsPatch
): Record<string, unknown> {
  let nextModelDefaults = { ...currentModelDefaults };

  if (body.modelRequestTimeoutMs !== undefined) {
    if (body.modelRequestTimeoutMs === null) {
      delete nextModelDefaults.modelRequestTimeoutMs;
      delete nextModelDefaults.modelRequestTimeoutSeconds;
      delete nextModelDefaults.hardTimeoutMs;
      delete nextModelDefaults.hardTimeoutSeconds;
    } else {
      nextModelDefaults.modelRequestTimeoutMs = body.modelRequestTimeoutMs;
      delete nextModelDefaults.modelRequestTimeoutSeconds;
      delete nextModelDefaults.hardTimeoutMs;
      delete nextModelDefaults.hardTimeoutSeconds;
    }
  }

  if (body.shellToolMaxTimeoutMs !== undefined) {
    if (body.shellToolMaxTimeoutMs === null) {
      delete nextModelDefaults.shellToolMaxTimeoutMs;
      delete nextModelDefaults.shellToolMaxTimeoutSeconds;
    } else {
      nextModelDefaults.shellToolMaxTimeoutMs = body.shellToolMaxTimeoutMs;
      delete nextModelDefaults.shellToolMaxTimeoutSeconds;
    }
  }

  if (body.mcpTimeoutMs !== undefined) {
    if (body.mcpTimeoutMs === null) {
      delete nextModelDefaults.mcpTimeoutMs;
      delete nextModelDefaults.mcpTimeoutSeconds;
    } else {
      nextModelDefaults.mcpTimeoutMs = body.mcpTimeoutMs;
      delete nextModelDefaults.mcpTimeoutSeconds;
    }
  }

  if (body.newMessageOrganizationEnabled !== undefined) {
    nextModelDefaults.newMessageOrganizationEnabled = body.newMessageOrganizationEnabled;
  }

  if (body.projectMasterEnabled !== undefined) {
    nextModelDefaults.projectMasterEnabled = body.projectMasterEnabled;
  }

  if (body.defaultAgentId !== undefined) {
    if (body.defaultAgentId) {
      nextModelDefaults.defaultAgentId = body.defaultAgentId;
    } else {
      delete nextModelDefaults.defaultAgentId;
    }
  }

  if (body.nativeCompactionEnabled !== undefined) {
    if (body.nativeCompactionEnabled) {
      delete nextModelDefaults.contextCompactionBackend;
    } else {
      nextModelDefaults.contextCompactionBackend = "summary";
    }
    delete nextModelDefaults.nativeCompaction;
  }

  if (body.sendMetadataToModel !== undefined) {
    if (body.sendMetadataToModel) {
      nextModelDefaults.sendMetadataToModel = true;
    } else {
      delete nextModelDefaults.sendMetadataToModel;
    }
  }

  if (body.claudeCacheKeepalive !== undefined) {
    if (body.claudeCacheKeepalive) {
      nextModelDefaults.claudeCacheKeepalive = true;
    } else {
      delete nextModelDefaults.claudeCacheKeepalive;
    }
  }

  if (body.codeModeEnabled !== undefined) {
    if (body.codeModeEnabled) {
      delete nextModelDefaults.codeModeEnabled;
    } else {
      nextModelDefaults.codeModeEnabled = false;
    }
  }

  if (body.systemPrompt !== undefined) {
    nextModelDefaults = setWorkspaceSystemPrompt(nextModelDefaults, body.systemPrompt);
  }

  if (body.personalityId !== undefined) {
    nextModelDefaults = setWorkspacePersonalityId(nextModelDefaults, body.personalityId);
  }

  if (body.sandboxNetworkEnabled !== undefined) {
    nextModelDefaults = setSandboxNetworkEnabledOverride(nextModelDefaults, body.sandboxNetworkEnabled);
  }

  if (body.defaultToolset !== undefined) {
    nextModelDefaults = setWorkspaceDefaultToolset(nextModelDefaults, body.defaultToolset);
  }

  if (body.thoughtPersistenceEnabled !== undefined) {
    nextModelDefaults = setWorkspaceThoughtPersistenceEnabled(nextModelDefaults, body.thoughtPersistenceEnabled);
  }

  if (body.memorySynthesisEnabled !== undefined) {
    nextModelDefaults = setWorkspaceMemorySynthesisEnabled(nextModelDefaults, body.memorySynthesisEnabled);
  }

  if (body.suggestedActionsEnabled !== undefined) {
    nextModelDefaults = setWorkspaceSuggestedActionsEnabled(nextModelDefaults, body.suggestedActionsEnabled);
  }

  return nextModelDefaults;
}

async function updateWorkspaceSettings(input: {
  wsId: string;
  body: WorkspaceSettingsPatch;
}): Promise<{ modelDefaults: Record<string, unknown>; memoryEnabled: boolean; runAsRoot: boolean }> {
  await query(
    `INSERT INTO workspace_settings (workspace_id, memory_enabled)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [input.wsId, DEFAULT_MEMORY_ENABLED]
  );

  return withTransaction(async (client) => {
    const currentRes = await client.query<{
      model_defaults_json: Record<string, unknown>;
      memory_enabled: boolean;
      run_as_root: boolean;
    }>(
      `SELECT model_defaults_json,
              memory_enabled,
              run_as_root
         FROM workspace_settings
        WHERE workspace_id = $1
        FOR UPDATE`,
      [input.wsId]
    );

    const nextModelDefaults = applyWorkspaceModelDefaultsPatch(
      currentRes.rows[0]?.model_defaults_json ?? {},
      input.body
    );
    let nextMemoryEnabled = currentRes.rows[0]?.memory_enabled ?? DEFAULT_MEMORY_ENABLED;
    let nextRunAsRoot = currentRes.rows[0]?.run_as_root === true;

    if (input.body.memoryEnabled !== undefined) {
      nextMemoryEnabled = input.body.memoryEnabled;
    }
    if (input.body.runAsRoot !== undefined) {
      nextRunAsRoot = input.body.runAsRoot;
    }

    const updatedRes = await client.query<{
      model_defaults_json: Record<string, unknown>;
      memory_enabled: boolean;
      run_as_root: boolean;
    }>(
      `UPDATE workspace_settings
          SET model_defaults_json = $2::jsonb,
              memory_enabled = $3,
              run_as_root = $4,
              updated_at = now()
        WHERE workspace_id = $1
        RETURNING model_defaults_json, memory_enabled, run_as_root`,
      [input.wsId, JSON.stringify(nextModelDefaults), nextMemoryEnabled, nextRunAsRoot]
    );

    return {
      modelDefaults: updatedRes.rows[0]?.model_defaults_json ?? {},
      memoryEnabled: updatedRes.rows[0]?.memory_enabled === true,
      runAsRoot: updatedRes.rows[0]?.run_as_root === true
    };
  });
}

async function ensureWorkspaceMemoryBootstrap(wsId: string): Promise<void> {
  const workspaceRes = await query<{ id: string; root_path: string }>(
    `SELECT id, root_path
       FROM workspaces
      WHERE id = $1`,
    [wsId]
  );
  if ((workspaceRes.rowCount ?? 0) === 0) {
    return;
  }

  const workspaceRoot = await ensureWorkspaceStorageRoot(workspaceRes.rows[0]);
  await ensureWorkspaceMemoryFiles(workspaceRoot);
}

async function listWorkspacesForBootstrap(userId: string): Promise<Array<{ id: string; name: string; iconKey: string; role: string; memberCount: number }>> {
  const workspacesRes = await query<{ id: string; name: string; icon_key: string; role: string; member_count: number }>(
    `SELECT w.id,
            w.name,
            w.icon_key,
            wm.role,
            (SELECT COUNT(*)::int FROM workspace_members member_wm WHERE member_wm.workspace_id = w.id) AS member_count
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1
      ORDER BY w.created_at ASC`,
    [userId]
  );

  return workspacesRes.rows.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    iconKey: workspace.icon_key,
    role: workspace.role,
    memberCount: workspace.member_count
  }));
}

async function listWorkspaceProjectsForBootstrap(wsId: string): Promise<Array<{
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  root_path: string;
  json_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}>> {
  const projectsRes = await query<{
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
    [wsId]
  );

  return projectsRes.rows;
}

async function getWorkspaceSettingsForBootstrap(wsId: string): Promise<ReturnType<typeof formatWorkspaceSettingsResponse>> {
  const settingsRes = await query<{
    model_defaults_json: Record<string, unknown>;
    memory_enabled: boolean;
    run_as_root: boolean;
  }>(
    `SELECT model_defaults_json,
            memory_enabled,
            run_as_root
       FROM workspace_settings
      WHERE workspace_id = $1`,
    [wsId]
  );

  if ((settingsRes.rowCount ?? 0) === 0) {
    await query(
      `INSERT INTO workspace_settings (workspace_id, memory_enabled)
       VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [wsId, DEFAULT_MEMORY_ENABLED]
    );
    return formatWorkspaceSettingsResponse({}, DEFAULT_MEMORY_ENABLED, false);
  }

  return formatWorkspaceSettingsResponse(
    settingsRes.rows[0]?.model_defaults_json ?? {},
    settingsRes.rows[0]?.memory_enabled ?? DEFAULT_MEMORY_ENABLED,
    settingsRes.rows[0]?.run_as_root === true
  );
}

export async function registerWorkspaceCoreRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/workspaces/:wsId/bootstrap", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = workspaceBootstrapQuerySchema.parse(request.query);
    await ensureUserHasWorkspace(request.user.id);
    await assertWorkspaceMember(params.wsId, request.user.id);

    const [userRes, workspaces, projects, workspaceSettings] = await Promise.all([
      query<{
        id: string;
        email: string;
        display_name: string | null;
        is_super_admin: boolean;
        byo_enabled: boolean;
        byo_provider: string | null;
        byo_forced_model: string | null;
        onboarding_completed_at: string | null;
        theme_preference: string | null;
        task_page_preferences_json: unknown;
      }>(
        `SELECT id,
                email,
                display_name,
                is_super_admin,
                byo_provider,
                byo_enabled,
                (SELECT forced_model
                   FROM user_chatgpt_auth
                  WHERE user_id = users.id) AS byo_forced_model,
                onboarding_completed_at::text,
                theme_preference,
                task_page_preferences_json
           FROM users
          WHERE id = $1`,
        [request.user.id]
      ),
      listWorkspacesForBootstrap(request.user.id),
      listWorkspaceProjectsForBootstrap(params.wsId),
      getWorkspaceSettingsForBootstrap(params.wsId)
    ]);

    if ((userRes.rowCount ?? 0) === 0) {
      return reply.status(404).send({ error: "User not found" });
    }

    const { task_page_preferences_json, ...user } = userRes.rows[0];
    const activeProject = queryInput.projectId
      ? projects.find((project) => project.id === queryInput.projectId) ?? null
      : null;

    return {
      user: {
        ...user,
        task_page_preferences: normalizeTaskPagePreferences(task_page_preferences_json)
      },
      workspaces,
      projects,
      workspaceSettings,
      activeProject
    };
  });

  fastify.get("/api/workspaces", { preHandler: fastify.authenticate }, async (request) => {
    await ensureUserHasWorkspace(request.user.id);

    const result = await query<WorkspaceListRow>(
      `SELECT w.id,
              w.name,
              w.icon_key,
              wm.role,
              wm.created_at::text AS joined_at,
              w.created_at::text AS created_at,
              w.updated_at::text AS updated_at,
              owner.owner_id,
              owner.owner_email,
              owner.owner_display_name,
              COALESCE(member_stats.member_count, 0) AS member_count,
              COALESCE(environment_stats.environment_count, 0) AS environment_count,
              COALESCE(invite_stats.pending_invite_count, 0) AS pending_invite_count
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         LEFT JOIN LATERAL (
           SELECT u.id AS owner_id,
                  u.email AS owner_email,
                  u.display_name AS owner_display_name
             FROM workspace_members owner_wm
             JOIN users u ON u.id = owner_wm.user_id
            WHERE owner_wm.workspace_id = w.id
              AND owner_wm.role = 'owner'
            ORDER BY owner_wm.created_at ASC
            LIMIT 1
         ) owner ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS member_count
             FROM workspace_members member_wm
            WHERE member_wm.workspace_id = w.id
         ) member_stats ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS environment_count
             FROM environments e
            WHERE e.workspace_id = w.id
         ) environment_stats ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS pending_invite_count
             FROM workspace_invites wi
            WHERE wi.workspace_id = w.id
              AND wi.status = 'pending'
         ) invite_stats ON TRUE
        WHERE wm.user_id = $1
        ORDER BY w.created_at ASC`,
      [request.user.id]
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        iconKey: row.icon_key,
        role: row.role,
        joinedAt: row.joined_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        owner:
          row.owner_id && row.owner_email
            ? {
                id: row.owner_id,
                email: row.owner_email,
                displayName: row.owner_display_name
              }
            : null,
        memberCount: row.member_count,
        projectCount: row.environment_count,
        environmentCount: row.environment_count,
        pendingInviteCount: row.pending_invite_count
      }))
    };
  });

  fastify.post("/api/workspaces", { preHandler: fastify.authenticate }, async (request, reply) => {
    const body = createWorkspaceSchema.parse(request.body);

    try {
      const result = await createWorkspaceForUser(request.user.id, body.name);
      return reply.status(201).send(result);
    } catch (error) {
      if (error instanceof WorkspaceLimitReachedError) {
        return reply.status(403).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.patch("/api/workspaces/:wsId", { preHandler: fastify.authenticate }, async (request, reply) => {
    const { wsId } = workspaceParamsSchema.parse(request.params);
    const body = updateWorkspaceSchema.parse(request.body);

    await assertWorkspaceMember(wsId, request.user.id);
    if (!(await isWorkspaceOwner(wsId, request.user.id))) {
      return reply.status(403).send({ error: "Only owners can edit workspaces" });
    }

    await query(
      `UPDATE workspaces
          SET name = $1,
              icon_key = $2,
              updated_at = now()
        WHERE id = $3`,
      [body.name, body.iconKey, wsId]
    );

    return { ok: true };
  });

  fastify.delete("/api/workspaces/:wsId", { preHandler: fastify.authenticate }, async (request, reply) => {
    const { wsId } = workspaceParamsSchema.parse(request.params);

    await assertWorkspaceMember(wsId, request.user.id);
    if (!(await isWorkspaceOwner(wsId, request.user.id))) {
      return reply.status(403).send({ error: "Only owners can delete workspaces" });
    }

    await query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    return { ok: true };
  });

  fastify.get("/api/workspaces/:wsId/settings", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    await assertWorkspaceMember(params.wsId, request.user.id);

    const settingsRes = await query<{
      model_defaults_json: Record<string, unknown>;
      memory_enabled: boolean;
      run_as_root: boolean;
    }>(
      `SELECT model_defaults_json,
              memory_enabled,
              run_as_root
         FROM workspace_settings
        WHERE workspace_id = $1`,
      [params.wsId]
    );

    if ((settingsRes.rowCount ?? 0) === 0) {
      await query(
        `INSERT INTO workspace_settings (workspace_id, memory_enabled)
         VALUES ($1, $2)
         ON CONFLICT (workspace_id) DO NOTHING`,
        [params.wsId, DEFAULT_MEMORY_ENABLED]
      );
      return reply.send(formatWorkspaceSettingsResponse({}, DEFAULT_MEMORY_ENABLED, false));
    }

    return reply.send(
      formatWorkspaceSettingsResponse(
        settingsRes.rows[0]?.model_defaults_json ?? {},
        settingsRes.rows[0]?.memory_enabled ?? DEFAULT_MEMORY_ENABLED,
        settingsRes.rows[0]?.run_as_root === true
      )
    );
  });

  fastify.patch(
    "/api/workspaces/:wsId/settings",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = workspaceParamsSchema.parse(request.params);
      const body = workspaceSettingsPatchSchema.parse(request.body);

      await assertWorkspaceMember(params.wsId, request.user.id);
      const [owner, superAdmin] = await Promise.all([
        isWorkspaceOwner(params.wsId, request.user.id),
        isSuperAdmin(request.user.id)
      ]);

      if (hasOwnerManagedWorkspaceSettings(body) && !owner) {
        return reply.status(403).send({ error: "Only owners can update workspace settings" });
      }
      if (body.runAsRoot !== undefined && !superAdmin) {
        return reply.status(403).send({ error: "Only super admins can change sandbox runtime user" });
      }
      if (body.defaultAgentId && !(await canUseAsWorkspaceDefaultAgent(request.user.id, body.defaultAgentId))) {
        return reply.status(400).send({ error: "Choose an available single-agent preset as the workspace default." });
      }

      const updatedSettings = await updateWorkspaceSettings({
        wsId: params.wsId,
        body
      });

      if (updatedSettings.memoryEnabled) {
        await ensureWorkspaceMemoryBootstrap(params.wsId);
      }

      return reply.send(
        formatWorkspaceSettingsResponse(
          updatedSettings.modelDefaults,
          updatedSettings.memoryEnabled,
          updatedSettings.runAsRoot
        )
      );
    }
  );
}
