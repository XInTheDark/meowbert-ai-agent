import { hasActiveHarnessSettings } from "@meowbert/shared";
import { HARNESS_SETTINGS_TOOL_GROUP_ID, TASK_SCHEDULING_TOOL_GROUP_ID } from "../agent-tools/index.js";
import type { HarnessRunState } from "./harness-run-state.js";
import type { RunScheduleInfo } from "./ports/run-bootstrap.js";

export interface RunToolGroups {
  // Groups the agent may load this run.
  allowed: string[];
  // Groups loaded from the start: the task already uses them.
  loaded: string[];
  // Groups listed for the agent to load on demand.
  onDemand: string[];
  allowScheduleTools: boolean;
  allowHarnessSettings: boolean;
}

// Which on-demand tool groups a run offers, and which start loaded because the task uses them.
export function resolveRunToolGroups(input: {
  readOnly: boolean;
  scheduleTaskEnabled: boolean;
  isProjectMaster: boolean;
  scheduleInfo: RunScheduleInfo | null;
  harness: HarnessRunState;
}): RunToolGroups {
  const allowScheduleTools = !input.readOnly && input.scheduleTaskEnabled;
  const allowHarnessSettings = allowScheduleTools && !input.isProjectMaster && input.harness.agentMayChange;
  const groups = [
    { id: TASK_SCHEDULING_TOOL_GROUP_ID, allowed: allowScheduleTools, inUse: input.scheduleInfo !== null },
    { id: HARNESS_SETTINGS_TOOL_GROUP_ID, allowed: allowHarnessSettings, inUse: hasActiveHarnessSettings(input.harness.settings) }
  ].filter((group) => group.allowed);
  return {
    allowed: groups.map((group) => group.id),
    loaded: groups.filter((group) => group.inUse).map((group) => group.id),
    onDemand: groups.filter((group) => !group.inUse).map((group) => group.id),
    allowScheduleTools,
    allowHarnessSettings
  };
}
