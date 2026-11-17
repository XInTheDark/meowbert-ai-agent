import { describe, expect, it } from "vitest";
import { mergeContextSeedItems } from "./history.js";

describe("Context Management V2 history", () => {
  it("keeps an existing window and appends a new follow-up seed", () => {
    const existing = [
      { role: "user", content: "First request\n[id: 00000000-0000-0000-0000-000000000001]" },
      { type: "function_call", call_id: "call-1", name: "run_shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call-1", output: "done" }
    ];
    const followUp = [
      { role: "user", content: "First request" },
      { type: "function_call", call_id: "call-1", name: "run_shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call-1", output: "done" },
      { role: "user", content: "Continue from there" }
    ];

    const result = mergeContextSeedItems(existing, followUp);

    expect(result.newItems).toEqual([{ role: "user", content: "Continue from there" }]);
    expect(result.conversationItems).toEqual([...existing, ...result.newItems]);
  });

  it("preserves ordering when new items are interleaved with repeated existing items", () => {
    const existing = [
      { role: "user", content: "same" },
      { role: "assistant", content: "first" },
      { role: "user", content: "same" },
      { role: "assistant", content: "last" }
    ];
    const seeds = [
      { role: "user", content: "same" },
      { role: "user", content: "new middle" },
      { role: "user", content: "same" },
      { role: "assistant", content: "last" },
      { role: "user", content: "new end" }
    ];

    const result = mergeContextSeedItems(existing, seeds);

    expect(result.newItems).toEqual([seeds[1], seeds[4]]);
    expect(result.conversationItems).toEqual([...existing, seeds[1], seeds[4]]);
  });

  it("keeps a cancelled run's recorded tool items when the seed rebuilds them from task messages", () => {
    const existing = [
      { role: "user", content: "Start" },
      { type: "function_call", call_id: "call-a", name: "notes_append_to_file", arguments: "{}", status: "completed" },
      { type: "function_call", call_id: "call-b", name: "exec", arguments: "{}", status: "completed" },
      { type: "function_call_output", call_id: "call-a", output: "{\"call_number\":1,\"context\":\"16%\"}" },
      { type: "function_call_output", call_id: "call-b", output: "{\"call_number\":2,\"logs\":\"ok\",\"context\":\"16%\"}" }
    ];
    const seeds = [
      { role: "user", content: "Start" },
      { type: "function_call", call_id: "call-b", name: "exec", arguments: "{}" },
      { type: "function_call_output", call_id: "call-b", output: "{\"logs\":\"ok\"}" },
      { type: "function_call", call_id: "call-a", name: "notes_append_to_file", arguments: "{}" },
      { type: "function_call_output", call_id: "call-a", output: "{}" },
      { role: "user", content: "Also check this" }
    ];

    const result = mergeContextSeedItems(existing, seeds);

    expect(result.newItems).toEqual([{ role: "user", content: "Also check this" }]);
    expect(result.conversationItems).toEqual([...existing, ...result.newItems]);
  });
});
