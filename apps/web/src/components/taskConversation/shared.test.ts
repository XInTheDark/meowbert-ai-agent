import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../../lib/types";
import { resolveHistoricalToolGroupMessages } from "./shared";

function createToolMessage(
  id: string,
  createdAt: string,
  contentJson: Record<string, unknown> = {}
): TaskMessage {
  return {
    id,
    role: "tool",
    content_json: {
      tool: "run_shell",
      ...contentJson
    },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: createdAt
  };
}

function createAssistantMessage(
  id: string,
  createdAt: string,
  responseItems: unknown[]
): TaskMessage {
  return {
    id,
    role: "assistant",
    content_json: {
      response_items: responseItems
    },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: createdAt
  };
}

describe("resolveHistoricalToolGroupMessages", () => {
  it("expands an open historical tool group as adjacent tool messages arrive", () => {
    const firstTool = createToolMessage("tool-1", "2026-04-13T10:00:00.000Z", { step: 0 });
    const secondTool = createToolMessage("tool-2", "2026-04-13T10:00:02.000Z", { step: 1 });

    const resolved = resolveHistoricalToolGroupMessages(
      [firstTool, secondTool],
      "tool-group:tool-1",
      [firstTool]
    );

    expect(resolved.map((message) => message.id)).toEqual(["tool-1", "tool-2"]);
  });

  it("resolves assistant response tool groups by their response-tools key", () => {
    const assistantMessage = createAssistantMessage("assistant-1", "2026-04-13T10:00:00.000Z", [
      {
        type: "custom_tool_call",
        id: "call-1",
        call_id: "call-1",
        name: "list_skills",
        input: "{\"q\":\"skills\"}"
      }
    ]);

    const resolved = resolveHistoricalToolGroupMessages(
      [assistantMessage],
      "assistant-1:response-tools",
      []
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe("assistant-1:response-tool:call-1");
    expect(resolved[0]?.content_json.tool).toBe("list_skills");
  });

  it("resolves response tools to their merged group without duplicating historical calls", () => {
    const historicalShell = createToolMessage("tool-1", "2026-04-13T10:00:00.000Z", {
      tool: "run_shell",
      callId: "call-1"
    });
    const assistantMessage = createAssistantMessage("assistant-1", "2026-04-13T10:00:01.000Z", [
      {
        type: "function_call",
        id: "fc-1",
        call_id: "call-1",
        name: "run_shell",
        arguments: "{}"
      },
      {
        type: "custom_tool_call",
        id: "call-2",
        call_id: "call-2",
        name: "apply_patch",
        input: "*** Begin Patch"
      }
    ]);

    const resolved = resolveHistoricalToolGroupMessages(
      [historicalShell, assistantMessage],
      "assistant-1:response-tools",
      []
    );

    expect(resolved.map((message) => message.id)).toEqual(["tool-1", "assistant-1:response-tool:call-2"]);
    expect(resolved[1]?.content_json.tool).toBe("apply_patch");
  });

  it("returns empty when all response tool calls are already represented in historical messages", () => {
    const historicalShell = createToolMessage("tool-1", "2026-04-13T10:00:00.000Z", {
      tool: "run_shell",
      callId: "call-1"
    });
    const historicalPatch = createToolMessage("tool-2", "2026-04-13T10:00:01.000Z", {
      tool: "apply_patch",
      callId: "call-2"
    });
    const assistantMessage = createAssistantMessage("assistant-1", "2026-04-13T10:00:02.000Z", [
      {
        type: "function_call",
        id: "fc-1",
        call_id: "call-1",
        name: "run_shell",
        arguments: "{}"
      },
      {
        type: "custom_tool_call",
        id: "call-2",
        call_id: "call-2",
        name: "apply_patch",
        input: "*** Begin Patch"
      }
    ]);

    const resolved = resolveHistoricalToolGroupMessages(
      [historicalShell, historicalPatch, assistantMessage],
      "assistant-1:response-tools",
      []
    );

    expect(resolved).toHaveLength(0);
  });

  it("groups contiguous run_shell and apply_patch tool messages in the same historical tool group", () => {
    const historicalShell = createToolMessage("tool-1", "2026-04-13T10:00:00.000Z", {
      tool: "run_shell",
      callId: "call-1"
    });
    const historicalPatch = createToolMessage("tool-2", "2026-04-13T10:00:01.000Z", {
      tool: "apply_patch",
      callId: "call-2"
    });

    const resolved = resolveHistoricalToolGroupMessages(
      [historicalShell, historicalPatch],
      "tool-group:tool-1",
      [historicalShell]
    );

    expect(resolved.map((m) => m.id)).toEqual(["tool-1", "tool-2"]);
  });
});
