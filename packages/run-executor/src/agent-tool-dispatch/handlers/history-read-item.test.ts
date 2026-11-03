import { describe, expect, it } from "vitest";
import type { StoredContextHistoryItem } from "../../agent/ports/run-control.js";
import { buildResponseTools } from "../../agent-tools/index.js";
import { readHistoryItems } from "./context-management-v2.js";

const items = [
  { id: "item-1", callNumber: null, item: { role: "user", content: "request" } },
  { id: "item-2", callNumber: 7, item: { type: "function_call", call_id: "c", name: "query_tasks", arguments: "{}" } },
  { id: "item-3", callNumber: 7, item: { type: "function_call_output", call_id: "c", output: "x".repeat(25_000) } }
] as unknown as StoredContextHistoryItem[];

describe("readHistoryItems", () => {
  it("finds an item by id", () => {
    const { items: found } = readHistoryItems(items, { item_id: "item-1", call_number: null, offset_chars: null });
    expect(found).toEqual([expect.objectContaining({ id: "item-1", role: "user", content: "request" })]);
  });

  it("returns a call and its output for a call number, and pages long content", () => {
    const { items: found } = readHistoryItems(items, { item_id: null, call_number: 7, offset_chars: null });
    expect(found.map((item) => item.id)).toEqual(["item-2", "item-3"]);
    expect(found[1].content).toHaveLength(20_000);
    expect(found[1].next_offset_chars).toBe(20_000);
    const { items: rest } = readHistoryItems(items, { item_id: "item-3", call_number: null, offset_chars: 20_000 });
    expect(rest[0].content).toHaveLength(5_000);
    expect(rest[0].next_offset_chars).toBeUndefined();
  });

  it("reports a missing item", () => {
    expect(() => readHistoryItems(items, { item_id: "nope", call_number: null, offset_chars: null })).toThrow("No such item");
  });
});

describe("history_read_item availability", () => {
  const names = (allowProjectMasterTools: boolean) => buildResponseTools(
    { webSearch: false } as never,
    [],
    { contextManagementVersion: "v2", allowProjectMasterTools }
  ).map((tool) => ("name" in tool ? tool.name : tool.type));

  it("is offered to the Project Master, which has no shell, and to nobody else", () => {
    expect(names(true)).toContain("history_read_item");
    expect(names(true)).not.toContain("run_shell");
    expect(names(false)).not.toContain("history_read_item");
  });
});
