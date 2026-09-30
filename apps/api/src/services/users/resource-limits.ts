import {
  resolveEffectiveSandboxContainerResources,
  resolveEffectiveWorkspaceStorageBytes,
  toOptionalNumber
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";

interface UserRuntimeResourceRow {
  sandbox_pids_limit: number | null;
  sandbox_memory_mb: number | null;
  sandbox_cpus: string | number | null;
  workspace_storage_mb: number | null;
  plan_sandbox_pids_limit: number | null;
  plan_sandbox_memory_mb: number | null;
  plan_sandbox_cpus: string | number | null;
  plan_workspace_storage_mb: number | null;
}

function buildResolvedSandboxResources(row: UserRuntimeResourceRow | null) {
  return resolveEffectiveSandboxContainerResources({
    defaults: config.runtime.sandbox.resources,
    subscriptionPlanSandboxPidsLimit: row?.plan_sandbox_pids_limit ?? null,
    subscriptionPlanSandboxMemoryMb: row?.plan_sandbox_memory_mb ?? null,
    subscriptionPlanSandboxCpus: toOptionalNumber(row?.plan_sandbox_cpus),
    sandboxPidsLimit: row?.sandbox_pids_limit ?? null,
    sandboxMemoryMb: row?.sandbox_memory_mb ?? null,
    sandboxCpus: toOptionalNumber(row?.sandbox_cpus)
  });
}

export async function resolveUserSandboxContainerResources(userId: string | null | undefined) {
  if (!userId) {
    return buildResolvedSandboxResources(null);
  }

  const result = await query<UserRuntimeResourceRow>(
    `SELECT u.sandbox_pids_limit,
            u.sandbox_memory_mb,
            u.sandbox_cpus::text AS sandbox_cpus,
            u.workspace_storage_mb,
            plan_limits.sandbox_pids_limit AS plan_sandbox_pids_limit,
            plan_limits.sandbox_memory_mb AS plan_sandbox_memory_mb,
            plan_limits.sandbox_cpus::text AS plan_sandbox_cpus,
            plan_limits.workspace_storage_mb AS plan_workspace_storage_mb
       FROM users u
       LEFT JOIN LATERAL (
         SELECT MAX(sp.sandbox_pids_limit)::int AS sandbox_pids_limit,
                MAX(sp.sandbox_memory_mb)::int AS sandbox_memory_mb,
                MAX(sp.sandbox_cpus)::numeric(10, 3) AS sandbox_cpus,
                MAX(sp.workspace_storage_mb)::int AS workspace_storage_mb
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

  return buildResolvedSandboxResources(result.rows[0] ?? null);
}

export async function resolveWorkspaceStorageLimitBytes(workspaceId: string): Promise<number | null> {
  const result = await query<UserRuntimeResourceRow>(
    `SELECT u.sandbox_pids_limit,
            u.sandbox_memory_mb,
            u.sandbox_cpus::text AS sandbox_cpus,
            u.workspace_storage_mb,
            plan_limits.sandbox_pids_limit AS plan_sandbox_pids_limit,
            plan_limits.sandbox_memory_mb AS plan_sandbox_memory_mb,
            plan_limits.sandbox_cpus::text AS plan_sandbox_cpus,
            plan_limits.workspace_storage_mb AS plan_workspace_storage_mb
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       LEFT JOIN LATERAL (
         SELECT MAX(sp.sandbox_pids_limit)::int AS sandbox_pids_limit,
                MAX(sp.sandbox_memory_mb)::int AS sandbox_memory_mb,
                MAX(sp.sandbox_cpus)::numeric(10, 3) AS sandbox_cpus,
                MAX(sp.workspace_storage_mb)::int AS workspace_storage_mb
           FROM subscription_plans sp
          WHERE sp.is_active = true
            AND (
              sp.is_default = true
              OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = u.id)
            )
       ) AS plan_limits ON true
      WHERE wm.workspace_id = $1
        AND wm.role = 'owner'
      ORDER BY wm.created_at ASC
      LIMIT 1`,
    [workspaceId]
  );

  return resolveEffectiveWorkspaceStorageBytes({
    defaults: config.runtime.sandbox.resources,
    subscriptionPlanWorkspaceStorageMb: result.rows[0]?.plan_workspace_storage_mb ?? null,
    workspaceStorageMb: result.rows[0]?.workspace_storage_mb ?? null
  });
}
