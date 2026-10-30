import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./service.js", () => ({ assertContextWindowOfTask: vi.fn() }));
vi.mock("./tools.js", () => ({}));
vi.mock("./notes.js", () => ({ writeContextNote: vi.fn() }));
vi.mock("./window-prompt.js", () => ({ freezeContextWindowPrompt: vi.fn() }));
import { assertContextWindowOfTask } from "./service.js";
import { writeContextNote } from "./notes.js";
import { freezeContextWindowPrompt } from "./window-prompt.js";
import { createDbContextStore } from "./db-store.js";
beforeEach(() => vi.resetAllMocks());

it.each([false, true])("binds note writes to the checked task/window even with a forged state, append=%s", async (append) => {
  const store = createDbContextStore("owned-task");
  const window = { taskId: "forged-task", windowId: "owned-window", contextNodeId: "owned-node" };
  const input = { path: "progress.md", text: "hello", append, state: { taskId: "foreign-task", contextNodeId: "foreign-node" } };
  await store.writeNote(window, input);
  await store.writeNote(window, input);
  expect(assertContextWindowOfTask).toHaveBeenCalledExactlyOnceWith({ ...window, taskId: "owned-task" });
  for (const [write] of vi.mocked(writeContextNote).mock.calls) {
    expect(write).toEqual({ path: input.path, text: input.text, append, state: { ...window, taskId: "owned-task" } });
  }
});

it("rejects a foreign window before invoking the writer", async () => {
  vi.mocked(assertContextWindowOfTask).mockRejectedValue(new Error("Not owned"));
  await expect(createDbContextStore("owned-task").writeNote({ taskId: "owned-task", windowId: "foreign", contextNodeId: "foreign" },
    { path: "a.md", text: "x", append: false })).rejects.toThrow("Not owned");
  expect(writeContextNote).not.toHaveBeenCalled();
});

it("binds the opening prompt to the owned task and returns its persisted snapshot", async () => {
  const saved = [{ role: "developer" as const, content: "original notes" }];
  vi.mocked(freezeContextWindowPrompt).mockResolvedValue(saved);
  const window = { taskId: "forged-task", windowId: "owned-window", contextNodeId: "owned-node" };
  const items = [{ role: "developer" as const, content: "updated notes" }];
  await expect(createDbContextStore("owned-task").freezeWindowPrompt(window, items)).resolves.toEqual(saved);
  expect(freezeContextWindowPrompt).toHaveBeenCalledExactlyOnceWith({ ...window, taskId: "owned-task" }, items);
});

it("rejects a foreign opening prompt before freezing it", async () => {
  vi.mocked(assertContextWindowOfTask).mockRejectedValue(new Error("Not owned"));
  await expect(createDbContextStore("owned-task").freezeWindowPrompt(
    { taskId: "owned-task", windowId: "foreign", contextNodeId: "foreign" }, []
  )).rejects.toThrow("Not owned");
  expect(freezeContextWindowPrompt).not.toHaveBeenCalled();
});
