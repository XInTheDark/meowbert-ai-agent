import { expect, it, vi } from "vitest";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { handleExec } from "./exec.js";
import { runCodeModeScript } from "../../code-mode/script-runtime.js";

vi.mock("../../code-mode/script-runtime.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../code-mode/script-runtime.js")>(), runCodeModeScript: vi.fn()
}));

it.each(["RUN_TIME_LIMIT_REACHED", "TASK_CANCELLED"])("preserves %s when a code-mode script is aborted", async (reason) => {
  const abort = new AbortController();
  vi.mocked(runCodeModeScript).mockImplementationOnce(async () => {
    abort.abort(new Error(reason));
    return { cancelled: true } as never;
  });
  const ctx = { cancellationSignal: abort.signal, assertNotCancelled: async () => {}, codeModeTools: [],
    taskDir: "/task", envRoot: "/project", shellEnvOverrides: {}, shellToolMaxTimeoutMs: 10_000,
    settings: { commandTimeoutMs: 1_000 }, control: { emitEvent: async () => {} }
  } as unknown as ToolDispatchContext;
  const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };
  await expect(handleExec({ type: "function_call", name: "exec", call_id: "exec",
    arguments: JSON.stringify({ code: "await tools.long_work({})", summary: null, timeout_seconds: null })
  }, ctx, state, vi.fn())).rejects.toThrow(reason);
});
