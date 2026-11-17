import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { appendRuntimeNotice } from "../agent/runtime-notices.js";
import { applyRunInboxAppend } from "./run-inbox.js";

describe("applyRunInboxAppend", () => {
  it("records notices already in the conversation ahead of the inbox messages", async () => {
    const recorded: ResponseInputItem[] = [];
    const execution = {
      prepared: {
        control: { context: { recordItems: async (_state: unknown, records: { item: ResponseInputItem }[]) => {
          recorded.push(...records.map((record) => record.item));
        } } }
      },
      state: {
        currentLeafMessageId: "leaf-0",
        contextManagement: { version: "v2" },
        dispatchState: { conversationItems: [], runPersistedItems: [] }
      }
    } as unknown as AgentExecutionContext;
    const notice = { role: "user" as const, content: "[System: window cleared]" };
    const laneResults = { role: "user" as const, content: "[Lane results] done" };

    appendRuntimeNotice(execution, notice);
    await applyRunInboxAppend(execution, { leafMessageId: "leaf-1", items: [laneResults] });

    expect(recorded.map((item) => (item as { content: string }).content))
      .toEqual(execution.state.dispatchState.conversationItems.map((item) => (item as { content: string }).content));
  });
});
