import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { selectRolloverToolItems } from "./rollover-tools.js";

function toolTurn(count: number, logSize: number): ResponseInputItem[] {
  return [
    ...Array.from({ length: count }, (_, index) => ({ type: "function_call" as const,
      call_id: `call-${index}`, name: "publish", arguments: "{}" })),
    ...Array.from({ length: count }, (_, index) => ({ type: "function_call_output" as const,
      call_id: `call-${index}`, output: JSON.stringify({ call_number: index + 1, success: index !== 2,
        receipt: `receipt-${index}`, status: index === 2 ? "failed" : "completed", stdout: "x".repeat(logSize) }) }))
  ];
}

describe("unread tool outcomes during rollover", () => {
  it("preserves a small tool turn with complete call/output pairing and exact receipts", () => {
    const items = toolTurn(2, 100);
    expect(selectRolloverToolItems(items, "previous-window")).toEqual(items);
  });

  it("carries every completion state, receipt and exact history reference when eight outputs overflow", () => {
    const items = toolTurn(8, 50_000);
    const retained = selectRolloverToolItems(items, "previous-window");
    expect(retained).toHaveLength(1);
    const content = (retained[0] as { content: string }).content;
    expect(content.length).toBeLessThan(24_000);
    const handoff = JSON.parse(content.slice(content.indexOf("\n") + 1));
    expect(handoff.outcomes).toHaveLength(8);
    for (let index = 0; index < 8; index += 1) {
      expect(handoff.outcomes[index]).toMatchObject({ window_id: "previous-window", call_id: `call-${index}`, call_number: index + 1 });
      const output = JSON.parse(handoff.outcomes[index].output);
      expect(output).toMatchObject({ success: index !== 2, receipt: `receipt-${index}`, status: index === 2 ? "failed" : "completed" });
    }
  });

  it("does not revive an older tool outcome after a new model response consumes it", () => {
    expect(selectRolloverToolItems([...toolTurn(1, 20), { role: "assistant", content: "I have used that result." }], "window")).toEqual([]);
  });

  it("retains an unread handoff across another rollover, then drops it after a model reply", () => {
    const retained = selectRolloverToolItems(toolTurn(8, 50_000), "previous-window");
    expect(selectRolloverToolItems(retained, "next-window")).toEqual(retained);
    expect(selectRolloverToolItems([...retained, { role: "assistant", content: "Receipts read." }], "next-window")).toEqual([]);
  });

  it("never forwards an unanswered provider call into a fresh window", () => {
    const items = toolTurn(2, 20).slice(0, 3);
    const retained = selectRolloverToolItems(items, "previous-window");
    expect(retained.every((item) => item.type !== "function_call")).toBe(true);
    expect(JSON.stringify(retained)).toContain("receipt-0");
  });
});
