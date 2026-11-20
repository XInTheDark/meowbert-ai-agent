import { expect, it, vi } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { RunContextStore } from "../agent/ports/run-control.js";
import { resolveContextManagementState } from "./window.js";

it("answers started and unstarted interrupted calls before a follow-up, preserving the cached prefix across resumes", async () => {
  const existing: ResponseInputItem[] = [
    { role: "user", content: "Start" },
    { type: "function_call", name: "run_shell", call_id: "started", arguments: "{}" },
    { type: "function_call", name: "run_shell", call_id: "unstarted", arguments: "{}" }
  ];
  const prefix = structuredClone(existing);
  const recordItems = vi.fn(async (_state, records) => { existing.push(...structuredClone(records.map((record) => record.item))); });
  const store = { freezeVersion: async () => "v2", openWindow: async () => ({ windowId: "window", contextNodeId: "private" }),
    loadWindowItems: async () => structuredClone(existing), recordItems } as unknown as RunContextStore;
  const input = { taskId: "task", requestedVersion: "v2" as const, runtimeModel: "test", branchLeafMessageId: "followup",
    seedItems: [{ role: "user", content: "Stop that and do this" }] as ResponseInputItem[] };
  const resumed = await resolveContextManagementState(store, input);
  expect(resumed.conversationItems.slice(0, prefix.length)).toEqual(prefix);
  expect(resumed.conversationItems.slice(prefix.length, -1)).toMatchObject([
    { type: "function_call_output", call_id: "started" }, { type: "function_call_output", call_id: "unstarted" }
  ]);
  expect(resumed.conversationItems.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("Stop that") });
  const after = await resolveContextManagementState(store, input);
  expect(after.conversationItems).toEqual(resumed.conversationItems);
  expect(recordItems).toHaveBeenCalledTimes(2);
});

it("recovers an actual output without replacing a completed prefix or repeating a known result", async () => {
  const done = { type: "function_call_output", call_id: "done", output: "original" };
  const existing = [{ type: "function_call", call_id: "done", name: "exec", arguments: "{}" }, done,
    { type: "custom_tool_call", call_id: "missing", name: "apply_patch", input: "patch" }];
  const output = { type: "custom_tool_call_output", call_id: "missing", output: "applied" };
  const { interruptedToolOutputs } = await import("./interrupted-outputs.js");
  expect(interruptedToolOutputs(existing as ResponseInputItem[], [done, output] as ResponseInputItem[])).toEqual([output]);
});
