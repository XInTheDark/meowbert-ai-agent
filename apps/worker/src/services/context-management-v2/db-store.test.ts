import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./service.js", () => ({ assertContextWindowOfTask: vi.fn() }));
vi.mock("./tools.js", () => ({}));
vi.mock("./notes.js", () => ({ writeContextNote: vi.fn() }));
import { assertContextWindowOfTask } from "./service.js";
import { writeContextNote } from "./notes.js";
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
