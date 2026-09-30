import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readTaskMessageOutlineOpenPreference,
  writeTaskMessageOutlineOpenPreference
} from "./taskMessageOutlinePreferences";

describe("taskMessageOutlinePreferences", () => {
  const localStorageMock = {
    values: new Map<string, string>(),
    getItem(key: string) {
      return this.values.has(key) ? this.values.get(key) ?? null : null;
    },
    setItem(key: string, value: string) {
      this.values.set(key, value);
    },
    clear() {
      this.values.clear();
    }
  };

  afterEach(() => {
    localStorageMock.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back when no preference has been stored", () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });
    expect(readTaskMessageOutlineOpenPreference(true)).toBe(true);
    expect(readTaskMessageOutlineOpenPreference(false)).toBe(false);
  });

  it("reads stored open and closed states", () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });
    localStorageMock.setItem("meowbert_task_message_outline_open", "1");
    expect(readTaskMessageOutlineOpenPreference(false)).toBe(true);

    localStorageMock.setItem("meowbert_task_message_outline_open", "0");
    expect(readTaskMessageOutlineOpenPreference(true)).toBe(false);
  });

  it("writes the state with a compact stable encoding", () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });
    writeTaskMessageOutlineOpenPreference(true);
    expect(localStorageMock.getItem("meowbert_task_message_outline_open")).toBe("1");

    writeTaskMessageOutlineOpenPreference(false);
    expect(localStorageMock.getItem("meowbert_task_message_outline_open")).toBe("0");
  });
});
