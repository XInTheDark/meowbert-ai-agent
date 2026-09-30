import { describe, expect, it } from "vitest";
import { prepareToolOutputForModel, pushCustomToolOutput, pushOutput, pushToolOutput } from "./state.js";
import type { ToolDispatchState } from "./types.js";

function createState(contextUsage: ToolDispatchState["contextUsage"]): ToolDispatchState {
  return {
    conversationItems: [],
    runPersistedItems: [],
    contextUsage,
    commandStep: 0
  };
}

describe("tool output context notices", () => {
  it("adds the exact previous-request usage to function tool output objects", () => {
    const state = createState({
      usedTokens: 64_000,
      maxContextTokens: 256_000,
      percent: 25
    });

    const item = pushOutput(state, "call-1", { ok: true }) as {
      output: string;
    };

    expect(JSON.parse(item.output)).toEqual({
      ok: true,
      context: "Model request that produced this tool call: 64000 / 256000 tokens (25%)."
    });
  });

  it("does not substitute an estimate when the provider omitted input-token usage", () => {
    const state = createState(null);

    const item = pushCustomToolOutput(state, "call-2", "plain result") as unknown as {
      output: string;
    };

    expect(JSON.parse(item.output)).toEqual({
      result: "plain result",
      context: "Previous model request context unavailable; the provider returned no input-token usage."
    });
  });

  it("preserves a tool's existing context field inside result", () => {
    const state = createState({ usedTokens: 1, maxContextTokens: 10, percent: 10 });
    const item = pushOutput(state, "call-3", { context: { source: "tool" } }) as { output: string };

    expect(JSON.parse(item.output)).toEqual({
      result: { context: { source: "tool" } },
      context: "Model request that produced this tool call: 1 / 10 tokens (10%)."
    });
  });

  it("appends token and time budget telemetry into tool context", () => {
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      contextUsage: { usedTokens: 5000, maxContextTokens: 128_000, percent: 4 },
      budgetTelemetry: {
        tokenBudget: 50_000,
        observedTokenUsage: 12_500,
        timeBudgetMinutes: 30,
        elapsedSeconds: 600,
        remainingSeconds: 1200,
        isWrapUpRequired: false
      },
      commandStep: 0
    };

    const item = pushOutput(state, "call-4", { ok: true }) as { output: string };
    const parsed = JSON.parse(item.output);
    expect(parsed.context).toContain("Model request that produced this tool call: 5000 / 128000 tokens (4%).");
    expect(parsed.context).toContain("Token budget: 12,500 / 50,000 weighted tokens (37,500 remaining).");
    expect(parsed.context).toContain("Time budget: 10.0 / 30 minutes (20.0m remaining).");
    expect(parsed.context).not.toContain("Wrap-up required");
  });

  it("appends wrap-up notice when budget limit is approaching or reached", () => {
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      contextUsage: { usedTokens: 5000, maxContextTokens: 128_000, percent: 4 },
      budgetTelemetry: {
        tokenBudget: 50_000,
        observedTokenUsage: 51_000,
        timeBudgetMinutes: 30,
        elapsedSeconds: 1650,
        remainingSeconds: 150,
        isWrapUpRequired: true
      },
      commandStep: 0
    };

    const item = pushOutput(state, "call-5", { ok: true }) as { output: string };
    const parsed = JSON.parse(item.output);
    expect(parsed.context).toContain("Token budget: 51,000 / 50,000 weighted tokens (0 remaining).");
    expect(parsed.context).toContain("Wrap-up required: You are approaching or have reached the budget limit.");
  });
});

describe("tool output request shaping", () => {
  it("does not echo input-only fields in model-facing tool output", () => {
    const cases = [
      ["run_shell", "command"],
      ["computer_local_shell", "command"],
      ["memory_search", "query"],
      ["enable_skill", "skill"],
      ["view_image", "file_path"],
      ["view_pdf_file", "file_path"],
      ["history_read_item", "item_id"],
      ["notes_read_file", "path"],
      ["notes_append_to_file", "path"],
      ["notes_write_file", "path"],
      ["wait", "seconds"],
      ["final_response", "notify"]
    ] as const;

    for (const [toolName, field] of cases) {
      const output = prepareToolOutputForModel(toolName, {
        [field]: "request value",
        result: "tool result"
      }) as Record<string, unknown>;

      expect(output).toEqual({ result: "tool result" });
    }
  });

  it("applies the same shaping to the function_call_output request item", () => {
    const state = createState(null);
    const item = pushToolOutput(state, "call-shell", "run_shell", {
      command: "python3 - <<'PY'\nprint('large command')\nPY",
      stdout: "done"
    }) as { output: string };

    expect(JSON.parse(item.output)).toEqual({
      stdout: "done",
      context: "Previous model request context unavailable; the provider returned no input-token usage."
    });
  });

  it("removes all input-only fields from partial final responses", () => {
    const state = createState(null);
    const item = pushToolOutput(state, "call-final", "final_response", {
      acknowledged: true,
      notify: true,
      partial: true
    }) as { output: string };

    expect(JSON.parse(item.output)).toEqual({
      acknowledged: true,
      context: "Previous model request context unavailable; the provider returned no input-token usage."
    });
  });
});
