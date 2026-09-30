import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../lib/api";
import type { TaskConversationPageResponse, TaskDetail, TaskMessage } from "../lib/types";
import {
  buildTaskChatExport,
  extractTaskChatMessageText,
  fetchTaskChatExportMessages
} from "./taskChatExport";

function buildMessage(overrides: Partial<TaskMessage>): TaskMessage {
  return {
    id: overrides.id ?? "message-1",
    role: overrides.role ?? "assistant",
    content_json: overrides.content_json ?? { text: "Hello" },
    message_metadata_json: overrides.message_metadata_json,
    parent_message_id: overrides.parent_message_id ?? null,
    edited_from_message_id: overrides.edited_from_message_id ?? null,
    created_at: overrides.created_at ?? "2026-05-09T07:00:00.000Z"
  };
}

function buildTask(overrides: Partial<TaskDetail["task"]> = {}): TaskDetail["task"] {
  return {
    id: "task-1",
    title: "Exportable Task",
    status: "completed",
    created_at: "2026-05-09T06:00:00.000Z",
    updated_at: "2026-05-09T07:00:00.000Z",
    source: "manual",
    ...overrides
  };
}

function buildPage(input: {
  messages: TaskMessage[];
  startIndex: number;
  endIndex: number;
  totalItems: number;
  hasOlder: boolean;
}): TaskConversationPageResponse {
  return {
    active_leaf_message_id: "leaf-1",
    messages: input.messages,
    message_page: {
      start_index: input.startIndex,
      end_index: input.endIndex,
      total_items: input.totalItems,
      has_older: input.hasOlder,
      has_newer: false
    },
    branch_options: {}
  };
}

describe("task chat export", () => {
  it("uses final_response text without tool call payloads", () => {
    const message = buildMessage({
      content_json: {
        response_items: [
          {
            type: "function_call",
            name: "final_response",
            arguments: JSON.stringify({ response: "First visible answer." })
          },
          {
            type: "custom_tool_call",
            name: "run_shell",
            input: "secret command"
          },
          {
            type: "message",
            content: [
              { type: "output_text", text: "Second visible answer." }
            ]
          }
        ]
      }
    });

    expect(extractTaskChatMessageText(message)).toBe("First visible answer.");
  });

  it("prefers stored assistant text over duplicate response items", () => {
    const message = buildMessage({
      content_json: {
        text: "Stored visible answer.",
        response_items: [
          {
            type: "function_call",
            name: "final_response",
            arguments: JSON.stringify({ response: "Stored visible answer." })
          },
          {
            type: "message",
            content: [
              { type: "output_text", text: "Stored visible answer." }
            ]
          }
        ]
      }
    });

    expect(extractTaskChatMessageText(message)).toBe("Stored visible answer.");
  });

  it("builds JSON with metadata while excluding tool messages", () => {
    const result = buildTaskChatExport({
      task: buildTask(),
      activeLeafMessageId: "leaf-1",
      exportedAt: "2026-05-09T08:00:00.000Z",
      format: "json",
      messages: [
        buildMessage({
          id: "user-1",
          role: "user",
          content_json: { text: "Question" },
          message_metadata_json: { client_timezone: "Asia/Singapore" }
        }),
        buildMessage({
          id: "tool-1",
          role: "tool",
          content_json: { tool: "run_shell", stdout: "hidden" }
        }),
        buildMessage({
          id: "assistant-1",
          role: "assistant",
          content_json: { text: "Answer" }
        })
      ]
    });

    const payload = JSON.parse(result.content) as {
      metadata: { message_count: number; task: { id: string } };
      messages: Array<{ id: string; content: string; message_metadata_json?: Record<string, unknown> }>;
    };

    expect(result.mimeType).toBe("application/json");
    expect(payload.metadata.task.id).toBe("task-1");
    expect(payload.metadata.message_count).toBe(2);
    expect(payload.messages.map((message) => message.id)).toEqual(["user-1", "assistant-1"]);
    expect(payload.messages[0].message_metadata_json).toEqual({ client_timezone: "Asia/Singapore" });
    expect(result.content).not.toContain("hidden");
  });

  it("builds Markdown as a readable message transcript", () => {
    const result = buildTaskChatExport({
      task: buildTask(),
      activeLeafMessageId: "leaf-1",
      exportedAt: "2026-05-09T08:00:00.000Z",
      format: "md",
      messages: [
        buildMessage({ role: "user", content_json: { text: "Question" } }),
        buildMessage({ role: "assistant", content_json: { text: "Answer" } })
      ]
    });

    expect(result.content).toBe("## User\n\nQuestion\n\n## Assistant\n\nAnswer");
  });

  it("fetches all active conversation pages in order", async () => {
    const newestPage = buildPage({
      messages: [buildMessage({ id: "assistant-2" })],
      startIndex: 1,
      endIndex: 2,
      totalItems: 2,
      hasOlder: true
    });
    const oldestPage = buildPage({
      messages: [buildMessage({ id: "user-1" })],
      startIndex: 0,
      endIndex: 1,
      totalItems: 2,
      hasOlder: false
    });
    const get = vi.fn()
      .mockResolvedValueOnce(newestPage)
      .mockResolvedValueOnce(oldestPage);
    const api = { get } as unknown as ApiClient;

    const result = await fetchTaskChatExportMessages({
      api,
      taskId: "task-1",
      activeLeafMessageId: "leaf-1"
    });

    expect(result.messages.map((message) => message.id)).toEqual(["user-1", "assistant-2"]);
    expect(get).toHaveBeenNthCalledWith(1, "/api/tasks/task-1/conversation?limit=200&activeLeafMessageId=leaf-1");
    expect(get).toHaveBeenNthCalledWith(2, "/api/tasks/task-1/conversation?limit=200&activeLeafMessageId=leaf-1&beforeIndex=1");
  });
});
