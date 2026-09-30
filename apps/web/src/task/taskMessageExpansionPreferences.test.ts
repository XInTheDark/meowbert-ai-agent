import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskMessageExpansionKey,
  isTaskMessageExpanded,
  persistTaskMessageExpanded
} from "./taskMessageExpansionPreferences";

function createLocalStorageMock() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
}

describe("task message expansion preferences", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });
  });

  it("remembers expanded messages by task and message", () => {
    const key = buildTaskMessageExpansionKey("task-1", "message-1");

    persistTaskMessageExpanded(key, true);

    expect(isTaskMessageExpanded(key)).toBe(true);
    expect(isTaskMessageExpanded(buildTaskMessageExpansionKey("task-2", "message-1"))).toBe(false);
  });

  it("forgets a message when the user collapses it again", () => {
    const key = buildTaskMessageExpansionKey("task-1", "message-1");
    persistTaskMessageExpanded(key, true);

    persistTaskMessageExpanded(key, false);

    expect(isTaskMessageExpanded(key)).toBe(false);
  });
});
