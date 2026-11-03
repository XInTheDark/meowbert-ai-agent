import type { ResponseInputItem } from "openai/resources/responses/responses";
import { describe, expect, it } from "vitest";
import { selectRolloverSeedItems } from "./rollover-seed.js";

const user = (content: string) => ({ role: "user", content }) as ResponseInputItem;
const finalResponse = (response: string) => ({
  type: "function_call", call_id: "call-1", name: "final_response", arguments: JSON.stringify({ response })
}) as ResponseInputItem;
const assistant = (text: string) => ({
  type: "message", role: "assistant", content: [{ type: "output_text", text }]
}) as unknown as ResponseInputItem;

describe("selectRolloverSeedItems", () => {
  it("keeps user messages, without replies or tool activity, while the agent is working", () => {
    const items = [
      user("first"),
      { type: "function_call", call_id: "call-2", name: "run_shell", arguments: "{}" } as ResponseInputItem,
      { type: "function_call_output", call_id: "call-2", output: "done" } as ResponseInputItem,
      assistant("working on it"),
      user("second")
    ];
    expect(selectRolloverSeedItems(items, { replies: false })).toEqual([user("first"), user("second")]);
  });

  it("turns the last reply of each exchange into a plain message when the task is at rest", () => {
    const items = [user("first"), assistant("interim"), finalResponse("answer"), user("second"), assistant("latest")];
    expect(selectRolloverSeedItems(items, { replies: true })).toEqual([
      user("first"),
      { role: "assistant", content: "answer" },
      user("second"),
      { role: "assistant", content: "latest" }
    ]);
  });

  it("skips runtime notices and images shown by tools", () => {
    const shown = { role: "user", content: [{ type: "input_image", image_url: "data:" }] } as unknown as ResponseInputItem;
    expect(selectRolloverSeedItems([user("real"), user("[System: wrap up]"), shown], { replies: false })).toEqual([user("real")]);
  });

  it("drops older messages past the budget and always keeps the latest exchange", () => {
    const items = [user("old"), user("a".repeat(11_000)), user("b".repeat(11_000)), finalResponse("c".repeat(50_000))];
    const seeds = selectRolloverSeedItems(items, { replies: true }) as Array<{ role: string; content: string }>;
    expect(seeds.map((seed) => seed.role)).toEqual(["user", "assistant"]);
    expect(seeds[0].content.startsWith("b")).toBe(true);
    expect(seeds[1].content.length).toBeLessThanOrEqual(12_000);
    expect(seeds[1].content).toContain("[excerpt truncated");
  });

  it("does not mutate the original items when history markers are added to seeds", () => {
    const original = user("request");
    const [seed] = selectRolloverSeedItems([original], { replies: false }) as Array<{ content: string }>;
    seed.content += "\n[id: x]";
    expect(original).toEqual(user("request"));
  });
});
