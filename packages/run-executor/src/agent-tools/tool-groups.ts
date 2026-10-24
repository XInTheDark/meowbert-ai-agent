import { EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME, SCHEDULE_TASK_TOOL_NAME } from "./shared.js";

// Built-in tools that most runs never need. They stay out of the request until the agent loads them
// with `enable_skill`, the same way it loads a skill's tools.
export const TASK_SCHEDULING_TOOL_GROUP_ID = "task-scheduling";

const TOOL_GROUPS: Record<string, { name: string; description: string; toolNames: string[] }> = {
  [TASK_SCHEDULING_TOOL_GROUP_ID]: {
    name: "Task scheduling",
    description: "Create recurring tasks or reminders, or change the current task's schedule.",
    toolNames: [SCHEDULE_TASK_TOOL_NAME, EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME]
  }
};

const TOOL_GROUP_BY_TOOL_NAME = new Map(
  Object.entries(TOOL_GROUPS).flatMap(([groupId, group]) => group.toolNames.map((toolName) => [toolName, groupId] as const))
);

export function isToolGroupTool(toolName: string): boolean {
  return TOOL_GROUP_BY_TOOL_NAME.has(toolName);
}

export function getToolGroupSummary(groupId: string): { name: string; description: string } | null {
  const group = TOOL_GROUPS[groupId];
  return group ? { name: group.name, description: group.description } : null;
}

// A tool outside every group is not gated here; a grouped tool is sent only once its group is loaded.
export function isToolGroupLoaded(toolName: string, loadedToolGroups: readonly string[] | undefined): boolean {
  const groupId = TOOL_GROUP_BY_TOOL_NAME.get(toolName);
  return groupId === undefined || loadedToolGroups?.includes(groupId) === true;
}

type EnableSkill = (skillId: string) => Promise<{ doc: string | null; toolNames: string[] }>;

// Routes `enable_skill` calls for the groups this run allows to a local load; other IDs are skills.
export function withToolGroups(
  enableSkill: EnableSkill,
  allowedToolGroups: readonly string[],
  loadedToolGroups: Set<string>
): EnableSkill {
  return async (skillId) => {
    const group = allowedToolGroups.includes(skillId) ? TOOL_GROUPS[skillId] : undefined;
    if (!group) return enableSkill(skillId);
    loadedToolGroups.add(skillId);
    return { doc: group.description, toolNames: group.toolNames };
  };
}
