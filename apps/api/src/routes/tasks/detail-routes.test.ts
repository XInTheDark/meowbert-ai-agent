import Fastify from "fastify";
import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../../services/workspaces/workspace-access.js", () => ({
  assertTaskMember: vi.fn(async () => {})
}));

vi.mock("../../services/tasks/task-service/index.js", () => ({
  resolveActiveLeafMessageId: vi.fn(async () => "msg-assistant")
}));

vi.mock("../../services/tasks/task-threads.js", () => ({
  listTaskThreadCounts: vi.fn(async () => [])
}));

vi.mock("../../services/admin/admin-settings.js", () => ({
  getAdminSettings: vi.fn(async () => ({ debugMode: false }))
}));

vi.mock("../../services/tasks/task-workflows.js", () => ({
  getTaskWorkflowOverview: vi.fn(async () => null)
}));

vi.mock("../../services/tasks/task-history.js", () => ({
  ensureTaskHistoryWarm: vi.fn(async () => {})
}));

vi.mock("../../services/canvases/project-canvases.js", () => ({
  listTaskCanvases: vi.fn(async () => [])
}));

vi.mock("./shared.js", async () => {
  const zod = await import("zod");
  return {
    buildTaskScheduleResponse: vi.fn(() => null),
    taskConversationQuery: zod.z.object({
      limit: zod.z.coerce.number().int().min(1).max(200).default(50),
      beforeIndex: zod.z.coerce.number().int().min(0).optional(),
      afterIndex: zod.z.coerce.number().int().min(0).optional(),
      activeLeafMessageId: zod.z.string().uuid().optional()
    }).refine((value) => !(value.beforeIndex !== undefined && value.afterIndex !== undefined), {
      message: "beforeIndex and afterIndex are mutually exclusive"
    }),
    taskConversationSearchQuery: zod.z.object({
      q: zod.z.string().min(1).max(500),
      page: zod.z.coerce.number().int().min(1).default(1),
      pageSize: zod.z.coerce.number().int().min(1).max(100).default(20),
      activeLeafMessageId: zod.z.string().uuid().optional()
    }),
    publicTaskShareParams: zod.z.object({ shareId: zod.z.string().uuid() }),
    taskDetailQuery: zod.z.object({
      messageDetail: zod.z.enum(["full", "metadata", "none"]).default("full")
    }),
    taskMessageContentBody: zod.z.object({
      ids: zod.z.array(zod.z.string().uuid()).min(1).max(200)
    }),
    taskParams: zod.z.object({ taskId: zod.z.string().uuid() }),
    uniqueIdsPreserveOrder: (ids: string[]) => Array.from(new Set(ids))
  };
});

import { query } from "../../lib/db.js";
import { listTaskCanvases } from "../../services/canvases/project-canvases.js";
import { registerTaskDetailRoutes } from "./detail-routes.js";

describe("registerTaskDetailRoutes", () => {
  const mockedQuery = vi.mocked(query);

  function createQueryResult<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
    return {
      command: "SELECT",
      rowCount,
      oid: 0,
      fields: [],
      rows
    };
  }

  beforeEach(() => {
    mockedQuery.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns task-associated canvases alongside marked file artifacts", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    mockedQuery.mockResolvedValueOnce(createQueryResult([{
      id: "artifact-1",
      kind: "artifact",
      relative_path: "report.pdf",
      size_bytes: 128,
      mime_type: "application/pdf",
      created_at: "2026-08-04T00:00:00.000Z"
    }]));
    vi.mocked(listTaskCanvases).mockResolvedValueOnce([{
      id: "canvas-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      name: "Quadratics Lab",
      slug: "quadratics-lab",
      rootPath: "canvases/quadratics-lab",
      entryPath: "index.html",
      runtimeMode: "static",
      devServer: {},
      lastTaskId: "326522d1-67cc-4475-92ce-a85b18556261",
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z"
    }]);

    await registerTaskDetailRoutes(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/326522d1-67cc-4475-92ce-a85b18556261/artifacts"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: "artifact-1", relative_path: "report.pdf" }],
      canvases: [{ id: "canvas-1", name: "Quadratics Lab" }]
    });
    expect(listTaskCanvases).toHaveBeenCalledWith("326522d1-67cc-4475-92ce-a85b18556261");
    await app.close();
  });

  it("keeps metadata-mode task detail responses lightweight for non-tool messages", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM tasks t")) {
        return createQueryResult([{
            id: "task-1",
            title: "Slow chat",
            status: "queued",
            cancellation_requested: false,
            resume_after_interrupt: false,
            workspace_id: "ws-1",
            environment_id: "env-1",
            source: "web",
            created_at: "2026-04-21T00:00:00.000Z",
            updated_at: "2026-04-21T00:00:00.000Z",
            completed_at: null,
            trashed_at: null,
            default_timezone: "UTC",
            max_steps_override: null,
            time_limit_seconds: null,
            allow_waiting: true,
            parent_task_id: null,
            subtask_depth: 0,
            task_root_path: ".meowbert/task-runs/task-1",
            workflow_type: null,
            is_thread: true,
            thread_parent_task_id: "parent-task",
            thread_parent_message_id: "parent-message",
            thread_selected_text: null,
            thread_agent_id: "agent-2",
            public_share_id: null,
            public_shared_at: null,
            schedule_mode: null,
            task_type: "standard",
            schedule_state: null,
            schedule_repeat_cron: null,
            schedule_timezone: null,
            schedule_next_run_at: null,
            schedule_pending_run: null,
            schedule_run_timeout_seconds: null,
            schedule_run_deadline_at: null
          }], 1);
      }

      if (sql.includes("CASE") && sql.includes("FROM task_messages")) {
        return createQueryResult([
            {
              id: "msg-user",
              role: "user",
              content_json: {},
              parent_message_id: null,
              edited_from_message_id: null,
              created_at: "2026-04-21T00:00:00.000Z"
            },
            {
              id: "msg-tool",
              role: "tool",
              content_json: {
                tool: "html_canvas_inline_artifact",
                callId: "call_canvas_1",
                durationMs: 180,
                response_function_output: {
                  output: JSON.stringify({
                    ok: true,
                    inline_artifact: {
                      type: "html",
                      relative_path: "reports/summary.html",
                      title: "Summary"
                    }
                  })
                }
              },
              parent_message_id: "msg-user",
              edited_from_message_id: null,
              created_at: "2026-04-21T00:00:01.000Z"
            },
            {
              id: "msg-assistant",
              role: "assistant",
              content_json: {},
              message_metadata_json: {
                message_time: "2026-04-21T00:00:02.000Z",
                agent_id: "default"
              },
              parent_message_id: "msg-tool",
              edited_from_message_id: null,
              created_at: "2026-04-21T00:00:02.000Z"
            }
          ], 3);
      }

      if (sql.includes("FROM task_runs")) {
        return createQueryResult([], 0);
      }

      if (sql.includes("FROM task_events")) {
        return createQueryResult([], 0);
      }

      if (sql.includes("FROM tasks") && sql.includes("parent_task_id = $1")) {
        return createQueryResult([], 0);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await registerTaskDetailRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/326522d1-67cc-4475-92ce-a85b18556261?messageDetail=metadata"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task.thread_agent_id).toBe("agent-2");
    expect(body.messages).toEqual([
      {
        id: "msg-user",
        role: "user",
        content_json: {},
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-04-21T00:00:00.000Z"
      },
      {
        id: "msg-tool",
        role: "tool",
        content_json: {
          tool: "html_canvas_inline_artifact",
          callId: "call_canvas_1",
          durationMs: 180,
          inline_artifact: {
            type: "html",
            relative_path: "reports/summary.html",
            title: "Summary"
          }
        },
        parent_message_id: "msg-user",
        edited_from_message_id: null,
        created_at: "2026-04-21T00:00:01.000Z"
      },
      {
        id: "msg-assistant",
        role: "assistant",
        content_json: {},
        message_metadata_json: {
          message_time: "2026-04-21T00:00:02.000Z",
          agent_id: "default"
        },
        parent_message_id: "msg-tool",
        edited_from_message_id: null,
        created_at: "2026-04-21T00:00:02.000Z"
      }
    ]);
    const messageMetadataQuery = mockedQuery.mock.calls.find(([sql]) =>
      sql.includes("CASE") && sql.includes("FROM task_messages")
    )?.[0];
    expect(messageMetadataQuery).toContain("'callId', tm.content_json->'callId'");
    const taskDetailQuery = mockedQuery.mock.calls.find(([sql]) =>
      sql.includes("FROM tasks t")
    )?.[0];
    expect(taskDetailQuery).toContain("tt.agent_id AS thread_agent_id");

    await app.close();
  });

  it("loads only the latest branch page with text-first non-tool payloads", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });

    mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("WITH RECURSIVE lineage AS") && sql.includes("ROW_NUMBER() OVER")) {
        return createQueryResult([
          {
            id: "msg-user",
            role: "user",
            content_json: { text: "hello" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-04-21T00:00:00.000Z",
            branch_index: 0
          },
          {
            id: "msg-tool",
            role: "tool",
            content_json: {
              tool: "web_search",
              durationMs: 180,
              response_function_output: { output: "{\"ok\":true}" }
            },
            parent_message_id: "msg-user",
            edited_from_message_id: null,
            created_at: "2026-04-21T00:00:01.000Z",
            branch_index: 1
          },
          {
            id: "msg-assistant",
            role: "assistant",
            content_json: {
              text: "Here is the result",
              response_items: [
                {
                  type: "reasoning",
                  id: "rs_1",
                  summary: [{ type: "summary_text", text: "reasoned" }]
                }
              ]
            },
            message_metadata_json: {
              message_time: "2026-04-21T00:00:02.000Z",
              agent_id: "deep-think"
            },
            parent_message_id: "msg-tool",
            edited_from_message_id: null,
            created_at: "2026-04-21T00:00:02.000Z",
            branch_index: 2
          }
        ], 3);
      }

      if (sql.includes("WITH selected_messages AS")) {
        expect(params?.[1]).toEqual(["msg-user", "msg-tool", "msg-assistant"]);
        return createQueryResult([
          {
            message_id: "msg-user",
            sibling_id: "msg-user",
            sibling_created_at: "2026-04-21T00:00:00.000Z",
            sibling_order: 0,
            sibling_count: 2,
            sibling_leaf_message_id: "leaf-a"
          },
          {
            message_id: "msg-user",
            sibling_id: "msg-user-alt",
            sibling_created_at: "2026-04-21T00:00:00.500Z",
            sibling_order: 1,
            sibling_count: 2,
            sibling_leaf_message_id: "leaf-b"
          },
          {
            message_id: "msg-tool",
            sibling_id: "msg-tool",
            sibling_created_at: "2026-04-21T00:00:01.000Z",
            sibling_order: 0,
            sibling_count: 1,
            sibling_leaf_message_id: "leaf-a"
          },
          {
            message_id: "msg-assistant",
            sibling_id: "msg-assistant",
            sibling_created_at: "2026-04-21T00:00:02.000Z",
            sibling_order: 0,
            sibling_count: 1,
            sibling_leaf_message_id: "leaf-a"
          }
        ], 4);
      }

      if (sql.includes("SELECT id") && sql.includes("FROM task_messages") && sql.includes("AND id = $2")) {
        return createQueryResult([{ id: "leaf-a" }], 1);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await registerTaskDetailRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/326522d1-67cc-4475-92ce-a85b18556261/conversation?limit=50&activeLeafMessageId=326522d1-67cc-4475-92ce-a85b18556261"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.active_leaf_message_id).toBe("326522d1-67cc-4475-92ce-a85b18556261");
    expect(body.messages).toEqual([
      {
        id: "msg-user",
        role: "user",
        content_json: { text: "hello" },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-04-21T00:00:00.000Z"
      },
      {
        id: "msg-tool",
        role: "tool",
        content_json: {
          tool: "web_search",
          durationMs: 180
        },
        parent_message_id: "msg-user",
        edited_from_message_id: null,
        created_at: "2026-04-21T00:00:01.000Z"
      },
      {
        id: "msg-assistant",
        role: "assistant",
        content_json: {
          text: "Here is the result",
          response_items: [
            {
              type: "reasoning",
              id: "rs_1",
              summary: [{ type: "summary_text", text: "reasoned" }]
            }
          ]
        },
        message_metadata_json: {
          message_time: "2026-04-21T00:00:02.000Z",
          agent_id: "deep-think"
        },
        parent_message_id: "msg-tool",
        edited_from_message_id: null,
        created_at: "2026-04-21T00:00:02.000Z"
      }
    ]);
    expect(body.message_page).toEqual({
      start_index: 0,
      end_index: 3,
      total_items: 3,
      has_older: false,
      has_newer: false
    });
    expect(body.branch_options["msg-user"]).toEqual({
      current_index: 0,
      sibling_count: 2,
      items: [
        { message_id: "msg-user", leaf_message_id: "leaf-a", index: 0 },
        { message_id: "msg-user-alt", leaf_message_id: "leaf-b", index: 1 }
      ]
    });

    await app.close();
  });

  it("normalizes string sibling metadata so branch options stay numeric", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });

    mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("WITH RECURSIVE lineage AS") && sql.includes("ROW_NUMBER() OVER")) {
        return createQueryResult([
          {
            id: "msg-user",
            role: "user",
            content_json: { text: "hello" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-04-21T00:00:00.000Z",
            branch_index: "0"
          },
          {
            id: "msg-assistant",
            role: "assistant",
            content_json: { text: "answer" },
            parent_message_id: "msg-user",
            edited_from_message_id: null,
            created_at: "2026-04-21T00:00:01.000Z",
            branch_index: "1"
          }
        ], 2);
      }

      if (sql.includes("WITH selected_messages AS")) {
        expect(params?.[1]).toEqual(["msg-user", "msg-assistant"]);
        return createQueryResult([
          {
            message_id: "msg-user",
            sibling_id: "msg-user",
            sibling_created_at: "2026-04-21T00:00:00.000Z",
            sibling_order: "0",
            sibling_count: "2",
            sibling_leaf_message_id: "leaf-a"
          },
          {
            message_id: "msg-user",
            sibling_id: "msg-user-alt",
            sibling_created_at: "2026-04-21T00:00:00.500Z",
            sibling_order: "1",
            sibling_count: "2",
            sibling_leaf_message_id: "leaf-b"
          },
          {
            message_id: "msg-assistant",
            sibling_id: "msg-assistant",
            sibling_created_at: "2026-04-21T00:00:01.000Z",
            sibling_order: "0",
            sibling_count: "1",
            sibling_leaf_message_id: "leaf-a"
          }
        ], 3);
      }

      if (sql.includes("SELECT id") && sql.includes("FROM task_messages") && sql.includes("AND id = $2")) {
        return createQueryResult([{ id: "leaf-a" }], 1);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await registerTaskDetailRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/326522d1-67cc-4475-92ce-a85b18556261/conversation?limit=50&activeLeafMessageId=326522d1-67cc-4475-92ce-a85b18556261"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.branch_options["msg-user"]).toEqual({
      current_index: 0,
      sibling_count: 2,
      items: [
        { message_id: "msg-user", leaf_message_id: "leaf-a", index: 0 },
        { message_id: "msg-user-alt", leaf_message_id: "leaf-b", index: 1 }
      ]
    });

    await app.close();
  });

  it("numbers each stored-text match without duplicating response item text", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("WITH RECURSIVE lineage AS") && sql.includes("ROW_NUMBER() OVER")) {
        return createQueryResult([
          {
            id: "msg-user",
            role: "user",
            content_json: { text: "question" },
            message_metadata_json: null,
            author_user_id: null,
            author_email: null,
            author_display_name: null,
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-04-21T00:00:00.000Z",
            branch_index: 0
          },
          {
            id: "msg-assistant",
            role: "assistant",
            content_json: {
              text: "Stored visible answer. stored again.",
              response_items: [
                {
                  type: "function_call",
                  call_id: "call_final",
                  name: "final_response",
                  arguments: JSON.stringify({ response: "Stored visible answer." })
                },
                {
                  type: "message",
                  role: "assistant",
                  content: [
                    { type: "output_text", text: "Stored visible answer." }
                  ]
                }
              ]
            },
            message_metadata_json: null,
            author_user_id: null,
            author_email: null,
            author_display_name: null,
            parent_message_id: "msg-user",
            edited_from_message_id: null,
            created_at: "2026-04-21T00:00:01.000Z",
            branch_index: 1
          }
        ], 2);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await registerTaskDetailRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/326522d1-67cc-4475-92ce-a85b18556261/conversation/search?q=Stored&pageSize=20"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.totalItems).toBe(2);
    expect(body.items).toEqual([
      expect.objectContaining({
        messageId: "msg-assistant",
        matchIndex: 0,
        matchText: "Stored"
      }),
      expect.objectContaining({
        messageId: "msg-assistant",
        matchIndex: 1,
        matchText: "stored"
      })
    ]);

    await app.close();
  });
});
