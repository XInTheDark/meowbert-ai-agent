import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMORY_ENABLED,
  DEFAULT_MEMORY_SYNTHESIS_ENABLED,
  DEFAULT_SUGGESTED_ACTIONS_ENABLED,
  DEFAULT_THOUGHT_PERSISTENCE_ENABLED,
  MAX_PROJECT_SUGGESTED_ACTIONS,
  createDefaultProjectMemoryMainFileContent,
  createDefaultProjectSuggestedActions,
  getProjectMemorySynthesisEnabled,
  getWorkspaceMemoryEnabled,
  getWorkspaceMemorySynthesisEnabled,
  getWorkspaceSuggestedActionsEnabled,
  getWorkspaceThoughtPersistenceEnabled,
  setWorkspaceMemorySynthesisEnabled,
  setProjectMemorySynthesisEnabled,
  setWorkspaceSuggestedActionsEnabled,
  setWorkspaceThoughtPersistenceEnabled,
  setWorkspaceMemoryEnabled
} from "./memory.js";

describe("workspace memory helpers", () => {
  it("defaults memory to enabled", () => {
    expect(DEFAULT_MEMORY_ENABLED).toBe(true);
    expect(getWorkspaceMemoryEnabled({})).toBe(true);
    expect(getWorkspaceMemoryEnabled(null)).toBe(true);
  });

  it("reads enabled workspace memory config", () => {
    expect(getWorkspaceMemoryEnabled({ memoryEnabled: true })).toBe(true);
    expect(getWorkspaceMemoryEnabled({ memory_enabled: true })).toBe(true);
  });

  it("reads disabled workspace memory config", () => {
    expect(getWorkspaceMemoryEnabled({ memoryEnabled: false })).toBe(false);
    expect(getWorkspaceMemoryEnabled({ memory_enabled: false })).toBe(false);
  });

  it("enables memory while preserving sibling payload keys", () => {
    expect(
      setWorkspaceMemoryEnabled(
        {
          modelRequestTimeoutMs: 1234
        },
        true
      )
    ).toEqual({
      modelRequestTimeoutMs: 1234,
      memoryEnabled: true
    });
  });

  it("disables memory with an explicit false override", () => {
    expect(
      setWorkspaceMemoryEnabled(
        {
          memoryEnabled: true,
          memory_enabled: true,
          shellToolMaxTimeoutMs: 5000
        },
        false
      )
    ).toEqual({
      memoryEnabled: false,
      shellToolMaxTimeoutMs: 5000
    });
  });
});

describe("project memory helpers", () => {
  it("creates default project memory content scoped to the project", () => {
    const content = createDefaultProjectMemoryMainFileContent("Launch Plan");

    expect(content).toContain("# PROJECT MEMORY");
    expect(content).toContain("Launch Plan");
    expect(content).toContain("workspace-wide facts");
    expect(content).toContain("project-specific plans");
  });

  it("creates default project suggested actions as empty list when none exist yet", () => {
    const actions = createDefaultProjectSuggestedActions();
    expect(actions).toEqual([]);
    expect(MAX_PROJECT_SUGGESTED_ACTIONS).toBe(8);
  });
});

describe("workspace thought persistence helpers", () => {
  it("defaults thought persistence to enabled", () => {
    expect(DEFAULT_THOUGHT_PERSISTENCE_ENABLED).toBe(true);
    expect(getWorkspaceThoughtPersistenceEnabled({})).toBe(true);
    expect(getWorkspaceThoughtPersistenceEnabled(null)).toBe(true);
  });

  it("reads an explicit disabled override", () => {
    expect(getWorkspaceThoughtPersistenceEnabled({ thoughtPersistenceEnabled: false })).toBe(false);
  });

  it("stores an explicit thought persistence override", () => {
    expect(
      setWorkspaceThoughtPersistenceEnabled(
        {
          modelRequestTimeoutMs: 1234
        },
        false
      )
    ).toEqual({
      modelRequestTimeoutMs: 1234,
      thoughtPersistenceEnabled: false
    });
  });
});

describe("workspace memory synthesis helpers", () => {
  it("defaults synthesis to disabled", () => {
    expect(DEFAULT_MEMORY_SYNTHESIS_ENABLED).toBe(false);
    expect(getWorkspaceMemorySynthesisEnabled({})).toBe(false);
  });

  it("stores synthesis enablement without retaining legacy message thresholds", () => {
    const stored = setWorkspaceMemorySynthesisEnabled({
      modelRequestTimeoutMs: 12_000,
      memorySynthesisMessageThreshold: 20
    }, true);

    expect(stored).toEqual({
      modelRequestTimeoutMs: 12_000,
      memorySynthesisEnabled: true
    });
    expect(getWorkspaceMemorySynthesisEnabled(stored)).toBe(true);
  });
});

describe("workspace suggested actions helpers", () => {
  it("defaults suggested actions to enabled", () => {
    expect(DEFAULT_SUGGESTED_ACTIONS_ENABLED).toBe(true);
    expect(getWorkspaceSuggestedActionsEnabled({})).toBe(true);
    expect(getWorkspaceSuggestedActionsEnabled(null)).toBe(true);
  });

  it("reads explicit suggested actions settings", () => {
    expect(getWorkspaceSuggestedActionsEnabled({ suggestedActionsEnabled: false })).toBe(false);
    expect(getWorkspaceSuggestedActionsEnabled({ suggestedActionsEnabled: true })).toBe(true);
  });

  it("stores suggested actions enablement while preserving other keys", () => {
    expect(
      setWorkspaceSuggestedActionsEnabled(
        {
          modelRequestTimeoutMs: 1234
        },
        false
      )
    ).toEqual({
      modelRequestTimeoutMs: 1234,
      suggestedActionsEnabled: false
    });
  });
});

describe("project memory synthesis helpers", () => {
  it("defaults projects to automatic refresh when the workspace feature is enabled", () => {
    expect(getProjectMemorySynthesisEnabled(null)).toBe(true);
    expect(getProjectMemorySynthesisEnabled({})).toBe(true);
    expect(getProjectMemorySynthesisEnabled({ memorySynthesisEnabled: false })).toBe(false);
  });

  it("stores a project opt-out without dropping other project settings", () => {
    expect(setProjectMemorySynthesisEnabled({ sandbox: { network_enabled: true } }, false)).toEqual({
      sandbox: { network_enabled: true },
      memorySynthesisEnabled: false
    });
  });
});
