import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readTaskWorkflowPanelOpenPreference,
  writeTaskWorkflowPanelOpenPreference
} from "./taskWorkflowPanelPreferences";

function createLocalStorageMock() {
  const values = new Map<string, string>();

  return {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    }
  };
}

describe("taskWorkflowPanelPreferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the fallback when no preference is stored", () => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock()
    });

    expect(readTaskWorkflowPanelOpenPreference({
      taskId: "task-1",
      workflowType: "agent_swarm"
    }, false)).toBe(false);
  });

  it("persists a separate open state for each task workflow", () => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock()
    });

    writeTaskWorkflowPanelOpenPreference({
      taskId: "task-1",
      workflowType: "agent_swarm"
    }, false);
    writeTaskWorkflowPanelOpenPreference({
      taskId: "task-1",
      workflowType: "long_horizon"
    }, true);

    expect(readTaskWorkflowPanelOpenPreference({
      taskId: "task-1",
      workflowType: "agent_swarm"
    })).toBe(false);
    expect(readTaskWorkflowPanelOpenPreference({
      taskId: "task-1",
      workflowType: "long_horizon"
    })).toBe(true);
  });
});
