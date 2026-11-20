import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: null as Client | null }));
vi.mock("../../lib/db.js", () => ({ query: (sql: string, values?: unknown[]) => state.client!.query(sql, values), withTransaction: vi.fn() }));
vi.mock("../storage/backend-registry.js", () => ({ storageBackendRegistry: {
  resolveManagedEnvironmentRoot: (_backend: string, workspace: string, project: string) => `/runtime/${workspace}/environments/${project}/root`,
  resolveManagedWorkspaceRoot: (_backend: string, workspace: string) => `/runtime/${workspace}/root`
} }));
vi.mock("../storage/local-xfs-project-quotas.js", () => ({
  listConfiguredLocalXfsProjectQuotaBackends: () => [{ id: "local" }],
  inspectConfiguredLocalXfsProjectQuotaBackend: async () => ({ ready: true })
}));

import { listAdminRuntimeMigrations } from "./runtime-migrations.js";

describe.skipIf(!process.env.TEST_CONTEXT_DATABASE_URL)("runtime migration candidate host isolation", () => {
  let schema: string;
  beforeEach(async () => {
    const client = new Client({ connectionString: process.env.TEST_CONTEXT_DATABASE_URL });
    await client.connect(); state.client = client;
    schema = `audit_migration_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE admin_runtime_migrations (
        id text, migration_key text, status text, error_summary text, summary_json jsonb,
        created_at timestamptz, updated_at timestamptz, started_at timestamptz, completed_at timestamptz
      );
      CREATE TABLE workspaces (id text PRIMARY KEY, root_path text, storage_backend_id text, storage_project_id int, file_host jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE environments (id text PRIMARY KEY, workspace_id text, root_path text, created_at timestamptz DEFAULT now());
      INSERT INTO workspaces VALUES ('server', '/runtime/server/root', 'local', NULL, '{"kind":"server"}', now()), ('device', '', 'local', NULL, '{"kind":"device"}', now());
      INSERT INTO environments VALUES ('server-project', 'server', '/runtime/server/environments/server-project/root', now()), ('device-project', 'device', 'projects/device-project', now());
    `);
  });
  afterEach(async () => {
    if (!state.client) return;
    await state.client.query(`DROP SCHEMA ${schema} CASCADE`);
    await state.client.end(); state.client = null;
  });

  it("excludes device roots from nesting and XFS provisioning while retaining server candidates", async () => {
    const summaries = await listAdminRuntimeMigrations();
    expect(summaries[0]).toMatchObject({ key: "nest_environment_roots", pendingItems: 0, status: "up_to_date" });
    expect(summaries[1]).toMatchObject({ key: "provision_local_xfs_project_quotas", pendingItems: 1, status: "ready" });
    await state.client!.query("UPDATE environments SET root_path = '/legacy/server-project' WHERE id = 'server-project'");
    const pending = await listAdminRuntimeMigrations();
    expect(pending[0]).toMatchObject({ pendingItems: 1, status: "ready" });
    expect(pending[1]).toMatchObject({ status: "action_required" });
  });
});
