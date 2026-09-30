import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TASK_RIGHT_SIDEBAR_WIDTH,
  MAX_TASK_RIGHT_SIDEBAR_WIDTH,
  MIN_TASK_RIGHT_SIDEBAR_WIDTH,
  readTaskRightSidebarWidthPreference,
  writeTaskRightSidebarWidthPreference
} from "./taskRightSidebarWidthPreferences";

const localStorageMock = {
  store: new Map<string, string>(),
  getItem(key: string) {
    return this.store.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    this.store.set(key, value);
  },
  clear() {
    this.store.clear();
  }
};

describe("taskRightSidebarWidthPreferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorageMock.clear();
  });

  it("falls back to the default width when localStorage is unavailable", () => {
    expect(readTaskRightSidebarWidthPreference()).toBe(DEFAULT_TASK_RIGHT_SIDEBAR_WIDTH);
  });

  it("reads and clamps persisted widths", () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });

    localStorageMock.setItem("meowbert_task_right_sidebar_width", "999");
    expect(readTaskRightSidebarWidthPreference()).toBe(MAX_TASK_RIGHT_SIDEBAR_WIDTH);

    localStorageMock.setItem("meowbert_task_right_sidebar_width", "200");
    expect(readTaskRightSidebarWidthPreference()).toBe(MIN_TASK_RIGHT_SIDEBAR_WIDTH);

    localStorageMock.setItem("meowbert_task_right_sidebar_width", "468");
    expect(readTaskRightSidebarWidthPreference()).toBe(468);
  });

  it("writes clamped widths", () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });

    writeTaskRightSidebarWidthPreference(900);
    expect(localStorageMock.getItem("meowbert_task_right_sidebar_width")).toBe(`${MAX_TASK_RIGHT_SIDEBAR_WIDTH}`);

    writeTaskRightSidebarWidthPreference(280);
    expect(localStorageMock.getItem("meowbert_task_right_sidebar_width")).toBe(`${MIN_TASK_RIGHT_SIDEBAR_WIDTH}`);
  });
});
