import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { reportInterruptedToolCalls } from "@meowbert/run-executor/agent/interrupted-tool-calls";
import { createFakeRunControl } from "../run-host/test-run-environment.test-fixtures.js";
import type { PreparedAgentRunContext } from "@meowbert/run-executor/agent/runtime";
import type { ContextManagementState } from "@meowbert/run-executor/context-management-v2/types";

function prepare(unfinishedToolCalls: PreparedAgentRunContext["unfinishedToolCalls"]) {
  const control = createFakeRunControl();
  const prepared = { control, unfinishedToolCalls, currentLeafMessageId: "leaf-1" } as unknown as PreparedAgentRunContext;
  return { control, prepared };
}

const v1 = { version: "v1" } as ContextManagementState;

describe("reportInterruptedToolCalls", () => {
  it("tells the agent about calls an earlier run left unfinished, on the current branch, and clears them", async () => {
    const { control, prepared } = prepare([
      { callId: "call-1", name: "run_shell", arguments: "{\"command\":\"git push\"}" }
    ]);
    const conversationItems: ResponseInputItem[] = [];

    const leaf = await reportInterruptedToolCalls({ prepared, contextManagement: v1, conversationItems });

    expect(control.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "system",
      parentMessageId: "leaf-1",
      content: expect.objectContaining({ kind: "interrupted_tool_calls", text: expect.stringContaining("git push") })
    }));
    expect(leaf).toBe("message-1");
    expect(control.selectBranch).toHaveBeenCalledWith("message-1");
    expect(conversationItems).toHaveLength(1);
    expect(control.resolveInterruptedToolCalls).toHaveBeenCalledWith(["call-1"]);
  });

  it("changes nothing when every earlier call finished", async () => {
    const { control, prepared } = prepare([]);
    const conversationItems: ResponseInputItem[] = [];

    const leaf = await reportInterruptedToolCalls({ prepared, contextManagement: v1, conversationItems });

    expect(leaf).toBe("leaf-1");
    expect(conversationItems).toEqual([]);
    expect(control.appendMessage).not.toHaveBeenCalled();
    expect(control.resolveInterruptedToolCalls).not.toHaveBeenCalled();
  });
});
