import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunLeaseClaims } from "@meowbert/shared/run-lease-token";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../sources/workspace-source-connections.js", () => ({ getWorkspaceSourceConnection: vi.fn() }));
vi.mock("../sources/source-access.js", () => ({ resolveWorkspaceSourceAccess: vi.fn() }));
import { query } from "../../lib/db.js";
import { getWorkspaceSourceConnection } from "../sources/workspace-source-connections.js";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import { listLocalLiveFolders, localLiveFolderConfig } from "./local-live-folders.js";

describe.skipIf(!process.env.TEST_LOCAL_LIVE_FOLDERS_DATABASE_URL)("live folder lease authorization", () => {
  const client = new Client({ connectionString: process.env.TEST_LOCAL_LIVE_FOLDERS_DATABASE_URL });
  const claims = { runId: "run", taskId: "task", holder: "device:device", epoch: 4 } as RunLeaseClaims;
  const connection = { workspaceId: "workspace", provider: "google-drive", accountId: "account", accountLabel: "owner",
    connectedAt: "2026-10-25", updatedByUserId: "owner", tokens: { accessToken: "access", refreshToken: "refresh", tokenType: "Bearer", expiresAt: null } };
  beforeAll(async () => {
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE devices (id text, user_id text, platform text, revoked_at timestamptz);
      CREATE TEMP TABLE tasks (id text, workspace_id text, environment_id text, cancellation_requested boolean, trashed_at timestamptz);
      CREATE TEMP TABLE task_runs (id text, ended_at timestamptz);
      CREATE TEMP TABLE workspace_members (workspace_id text, user_id text);
      CREATE TEMP TABLE task_run_dispatches (run_id text, task_id text, lease_epoch integer, lease_device_id text,
        queue_state text, lease_holder text, lease_expires_at timestamptz, payload_json jsonb);
      CREATE TEMP TABLE source_file_links (id text, workspace_id text, environment_id text, task_id text,
        provider text, link_kind text, local_relative_path text, remote_item_id text);
    `);
    vi.mocked(query).mockImplementation((sql, parameters) => client.query(sql, parameters) as never);
  });
  afterAll(async () => { await client.end(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    await client.query(`
      TRUNCATE devices, tasks, task_runs, workspace_members, task_run_dispatches, source_file_links;
      INSERT INTO devices VALUES ('device', 'owner', 'darwin', NULL);
      INSERT INTO tasks VALUES ('task', 'workspace', 'project', false, NULL);
      INSERT INTO task_runs VALUES ('run', NULL);
      INSERT INTO workspace_members VALUES ('workspace', 'owner');
      INSERT INTO task_run_dispatches VALUES ('run', 'task', 4, 'device', 'running', 'device:device',
        now() + interval '1 minute', '{"executionTarget":{"kind":"local","deviceId":"device","mode":"sandbox"}}');
      INSERT INTO source_file_links VALUES ('link', 'workspace', 'project', NULL, 'google-drive', 'folder', 'context/docs', 'remote');
    `);
    vi.mocked(getWorkspaceSourceConnection).mockResolvedValue(connection as never);
    vi.mocked(resolveWorkspaceSourceAccess).mockResolvedValue({ connection, settings: { clientId: "client", clientSecret: "secret" } } as never);
  });
  it.each(["sandbox", "host"])("allows consented attached folders for a current macOS %s lease", async (mode) => {
    await client.query("UPDATE task_run_dispatches SET payload_json = jsonb_set(payload_json, '{executionTarget,mode}', to_jsonb($1::text))", [mode]);
    const [folder] = await listLocalLiveFolders(claims);
    expect(folder.linkId).toBe("link");
    expect(resolveWorkspaceSourceAccess).not.toHaveBeenCalled();
    const config = await localLiveFolderConfig(claims, folder.linkId, folder.connectionId);
    expect(config.config).toContain("root_folder_id = remote");
  });
  it.each([
    "UPDATE devices SET platform = 'win32'",
    "UPDATE devices SET revoked_at = now()",
    "UPDATE task_run_dispatches SET queue_state = 'pending'",
    "UPDATE task_run_dispatches SET lease_expires_at = now() - interval '1 second'",
    "UPDATE task_run_dispatches SET lease_epoch = 5",
    "UPDATE task_run_dispatches SET payload_json = jsonb_set(payload_json, '{executionTarget,deviceId}', to_jsonb('other-device'::text))",
    "UPDATE task_run_dispatches SET payload_json = jsonb_set(payload_json, '{executionTarget,mode}', to_jsonb('invalid'::text))",
    "UPDATE tasks SET cancellation_requested = true",
    "UPDATE tasks SET trashed_at = now()",
    "UPDATE task_runs SET ended_at = now()",
    "DELETE FROM workspace_members"
  ])("rejects unavailable or mismatched leases: %s", async (mutation) => {
    await client.query(mutation);
    await expect(listLocalLiveFolders(claims)).rejects.toMatchObject({ code: "lease_lost" });
    expect(resolveWorkspaceSourceAccess).not.toHaveBeenCalled();
  });
});
