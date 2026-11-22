import { describe, expect, it } from "vitest";
import { EMPTY_HARNESS_SETTINGS } from "@meowbert/shared";
import { HARNESS_SETTINGS_TOOL_GROUP_ID, TASK_SCHEDULING_TOOL_GROUP_ID } from "../agent-tools/index.js";
import { createHarnessRunState } from "./harness-run-state.js";
import { resolveRunToolGroups } from "./run-tool-groups.js";

function harness(input: { agentMayChange: boolean; withBudget?: boolean }) {
  return createHarnessRunState({
    settings: input.withBudget ? { ...EMPTY_HARNESS_SETTINGS, tokenBudget: { value: 1_000, setBy: "user" } } : EMPTY_HARNESS_SETTINGS,
    spentTokens: 0,
    maxStopCheckAttempts: 3,
    agentMayChange: input.agentMayChange
  });
}

const base = { readOnly: false, scheduleTaskEnabled: true, isProjectMaster: false, scheduleInfo: null };

describe("resolveRunToolGroups", () => {
  it("lists harness settings on demand for a task that may change them", () => {
    const groups = resolveRunToolGroups({ ...base, harness: harness({ agentMayChange: true }) });
    expect(groups.allowHarnessSettings).toBe(true);
    expect(groups.onDemand).toEqual([TASK_SCHEDULING_TOOL_GROUP_ID, HARNESS_SETTINGS_TOOL_GROUP_ID]);
    expect(groups.loaded).toEqual([]);
  });

  it("starts with the group loaded when a setting is already active", () => {
    const groups = resolveRunToolGroups({ ...base, harness: harness({ agentMayChange: true, withBudget: true }) });
    expect(groups.loaded).toEqual([HARNESS_SETTINGS_TOOL_GROUP_ID]);
    expect(groups.onDemand).toEqual([TASK_SCHEDULING_TOOL_GROUP_ID]);
  });

  it("offers no harness settings to read-only runs, the Project Master or non-root tasks", () => {
    expect(resolveRunToolGroups({ ...base, readOnly: true, harness: harness({ agentMayChange: true }) }).allowHarnessSettings).toBe(false);
    expect(resolveRunToolGroups({ ...base, isProjectMaster: true, harness: harness({ agentMayChange: true }) }).allowHarnessSettings).toBe(false);
    const child = resolveRunToolGroups({ ...base, harness: harness({ agentMayChange: false, withBudget: true }) });
    expect(child.allowHarnessSettings).toBe(false);
    expect(child.allowed).not.toContain(HARNESS_SETTINGS_TOOL_GROUP_ID);
  });
});
