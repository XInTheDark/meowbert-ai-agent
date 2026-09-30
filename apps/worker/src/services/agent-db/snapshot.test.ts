import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResultRow } from "pg";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../tasks/task-history.js", () => ({
  ensureTaskHistoryWarm: vi.fn(async () => {})
}));

vi.mock("./messages.js", () => ({
  getNewestLeafMessageId: vi.fn(async () => null),
  loadBranchPathMessages: vi.fn(async () => [])
}));

import { query } from "../../lib/db.js";
import { getTaskSnapshot } from "./snapshot.js";

const mockedQuery = vi.mocked(query);

function queryResult<T>(rows: T[]) {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}

function mockBaseSnapshotQueries(input: {
  githubAppRows: QueryResultRow[];
  legacyTableRows?: QueryResultRow[];
  legacyConnectionRows?: QueryResultRow[];
}) {
  mockedQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM tasks") && sql.includes("LEFT JOIN task_threads")) {
      return queryResult([{
        id: "task-1",
        title: "Task",
        workspace_id: "workspace-1",
        environment_id: "project-1",
        status: "queued",
        source: "web",
        initiator_user_id: "user-1",
        connector_context_id: null,
        default_timezone: "UTC",
        max_steps_override: null,
        time_limit_seconds: null,
        time_limit_deadline_at: null,
        allow_waiting: true,
        parent_task_id: null,
        subtask_depth: 0,
        task_root_path: null,
        is_thread: false,
        thread_parent_task_id: null,
        thread_parent_message_id: null,
        thread_selected_text: null,
        workflow_type: null,
        workflow_parent_task_id: null,
        workflow_internal_role: null,
        interactive_canvas_id: null,
        interactive_canvas_intent: null
      }]);
    }

    if (sql.includes("FROM environments e")) {
      return queryResult([{
        id: "project-1",
        name: "Project",
        root_path: "project",
        json_payload: {},
        workspace_root_path: "/workspace",
        workspace_memory_enabled: false,
        workspace_run_as_root: false
      }]);
    }

    if (sql.includes("SELECT ws.model_defaults_json")) {
      return queryResult([{ model_defaults_json: {} }]);
    }

    if (sql.includes("FROM platform_settings")) {
      return queryResult([{
        agent_presets_json: null,
        model_metadata_json: null,
        model_routers_json: null,
        enable_prompt_caching: true
      }]);
    }

    if (sql.includes("FROM workspace_github_apps")) {
      return queryResult(input.githubAppRows);
    }

    if (sql.includes("to_regclass('workspace_github_connections')")) {
      return queryResult(input.legacyTableRows ?? [{ table_name: null }]);
    }

    if (sql.includes("FROM workspace_github_connections")) {
      return queryResult(input.legacyConnectionRows ?? []);
    }

    if (sql.includes("JOIN users u")) {
      return queryResult([{
        id: "user-1",
        is_super_admin: false,
        byo_enabled: false,
        byo_provider: null,
        byo_base_url: null,
        byo_api_key: null,
        byo_model: null
      }]);
    }

    throw new Error(`Unexpected query: ${sql}`);
  });
}

describe("getTaskSnapshot GitHub connection", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("loads a usable GitHub App connection", async () => {
    mockBaseSnapshotQueries({
      githubAppRows: [{
        app_id: "123",
        app_slug: "meowbert-app",
        private_key_pem: "key",
        installation_id: "456",
        default_org: "octocat"
      }]
    });

    const snapshot = await getTaskSnapshot("task-1");

    expect(snapshot.github_connection).toEqual({
      type: "app",
      app_id: "123",
      app_slug: "meowbert-app",
      private_key_pem: "key",
      installation_id: "456",
      default_org: "octocat"
    });
    expect(mockedQuery.mock.calls.some(([sql]) => String(sql).includes("workspace_github_connections"))).toBe(false);
  });

  it("falls back to the legacy OAuth connection when no installed App connection exists", async () => {
    mockBaseSnapshotQueries({
      githubAppRows: [],
      legacyTableRows: [{ table_name: "workspace_github_connections" }],
      legacyConnectionRows: [{
        github_login: "octocat",
        github_name: "Jerry",
        github_email: "jerry@example.com",
        access_token: "gho_token",
        default_org: "octocat"
      }]
    });

    const snapshot = await getTaskSnapshot("task-1");

    expect(snapshot.github_connection).toEqual({
      type: "oauth",
      github_login: "octocat",
      github_name: "Jerry",
      github_email: "jerry@example.com",
      access_token: "gho_token",
      default_org: "octocat"
    });
  });

  it("does not treat an uninstalled GitHub App connector as a usable connection", async () => {
    mockBaseSnapshotQueries({
      githubAppRows: [],
      legacyTableRows: [{ table_name: null }]
    });

    const snapshot = await getTaskSnapshot("task-1");

    expect(snapshot.github_connection).toBeNull();
    const appQuery = mockedQuery.mock.calls.find(([sql]) => String(sql).includes("FROM workspace_github_apps"))?.[0];
    expect(String(appQuery)).toContain("wga.installation_id IS NOT NULL");
  });
});
