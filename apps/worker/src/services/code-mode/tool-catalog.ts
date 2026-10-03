import type { FunctionTool } from "openai/resources/responses/responses";
import { parseSkillToolName, providerSafeSkillToolId } from "../agent/mcp-client.js";
import {
  CREATE_CHANNEL_TOOL_NAME,
  CREATE_INTERACTIVE_CANVAS_TOOL_NAME,
  EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
  GET_LIVE_SYNC_STATUS_TOOL_NAME,
  LIST_CHANNELS_TOOL_NAME,
  LIST_LIVE_SYNC_FILES_TOOL_NAME,
  MARK_ARTIFACT_TOOL_NAME,
  MEMORY_SEARCH_TOOL_NAME,
  PULL_LIVE_SYNC_FILE_TOOL_NAME,
  PUSH_LIVE_SYNC_FILE_TOOL_NAME,
  QUERY_TASKS_TOOL_NAME,
  READ_CHANNEL_TOOL_NAME,
  REFRESH_GH_TOKEN_TOOL_NAME,
  REFRESH_INBOX_TOOL_NAME,
  RUN_SHELL_TOOL_NAME,
  SCHEDULE_TASK_TOOL_NAME,
  SEARCH_WEB_TOOL_NAME,
  SHELL_SESSION_TOOL_NAME,
  SWARM_BUDGET_STATUS_TOOL_NAME,
  SWARM_CANCEL_NODE_TOOL_NAME,
  SWARM_GRANT_BUDGET_TOOL_NAME,
  SWARM_MANAGE_TOOL_NAME,
  SWARM_RECORD_FINAL_REVIEW_TOOL_NAME,
  SWARM_RECORD_REVIEW_TOOL_NAME,
  SWARM_SPAWN_NODE_TOOL_NAME,
  VIEW_TASK_HISTORY_TOOL_NAME
} from "../agent-tools/index.js";
import { SUBAGENT_TOOL_NAMES } from "../agent-tools/subagents.js";

// How exec presents the tools it can call. Warm tools, which most tasks reach for, are documented in
// full in exec's description. Every other tool is cold: exec lists it by name under its group, and
// search_tools documents it on demand. A loaded skill is one group; built-ins group by feature.

const WARM_TOOL_NAMES = new Set<string>([
  RUN_SHELL_TOOL_NAME,
  SHELL_SESSION_TOOL_NAME,
  SEARCH_WEB_TOOL_NAME,
  MEMORY_SEARCH_TOOL_NAME,
  MARK_ARTIFACT_TOOL_NAME
]);

const BUILT_IN_GROUPS: Record<string, readonly string[]> = {
  subagents: SUBAGENT_TOOL_NAMES,
  task_history: [QUERY_TASKS_TOOL_NAME, VIEW_TASK_HISTORY_TOOL_NAME],
  live_sync: [LIST_LIVE_SYNC_FILES_TOOL_NAME, GET_LIVE_SYNC_STATUS_TOOL_NAME, PULL_LIVE_SYNC_FILE_TOOL_NAME, PUSH_LIVE_SYNC_FILE_TOOL_NAME],
  scheduling: [SCHEDULE_TASK_TOOL_NAME, EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME],
  canvas: [CREATE_INTERACTIVE_CANVAS_TOOL_NAME],
  github: [REFRESH_GH_TOKEN_TOOL_NAME],
  swarm: [
    SWARM_MANAGE_TOOL_NAME, SWARM_BUDGET_STATUS_TOOL_NAME, SWARM_SPAWN_NODE_TOOL_NAME, SWARM_GRANT_BUDGET_TOOL_NAME,
    SWARM_CANCEL_NODE_TOOL_NAME, SWARM_RECORD_REVIEW_TOOL_NAME, SWARM_RECORD_FINAL_REVIEW_TOOL_NAME,
    REFRESH_INBOX_TOOL_NAME, LIST_CHANNELS_TOOL_NAME, READ_CHANNEL_TOOL_NAME, CREATE_CHANNEL_TOOL_NAME
  ]
};

const BUILT_IN_GROUP_BY_TOOL = new Map(
  Object.entries(BUILT_IN_GROUPS).flatMap(([group, names]) => names.map((name) => [name, group] as const))
);

const OTHER_GROUP = "other";

export interface ToolCatalogGroup {
  id: string;
  tools: FunctionTool[];
}

export function isWarmTool(tool: FunctionTool): boolean {
  return WARM_TOOL_NAMES.has(tool.name);
}

export function toolGroupId(tool: FunctionTool): string {
  return parseSkillToolName(tool.name)?.skillId ?? BUILT_IN_GROUP_BY_TOOL.get(tool.name) ?? OTHER_GROUP;
}

// Accepts a group as exec lists it or by its skill id ("google-workspace" for "google_workspace").
export function normalizeGroupId(group: string): string {
  return providerSafeSkillToolId(group.trim());
}

// The name a tool goes by inside its group: a skill tool without its skill prefix.
export function shortToolName(tool: FunctionTool): string {
  return parseSkillToolName(tool.name)?.toolName ?? tool.name;
}

// Groups the cold tools, keeping the order they were offered in.
export function groupColdTools(tools: FunctionTool[]): ToolCatalogGroup[] {
  const groups = new Map<string, FunctionTool[]>();
  for (const tool of tools) {
    if (isWarmTool(tool)) continue;
    const id = toolGroupId(tool);
    groups.set(id, [...(groups.get(id) ?? []), tool]);
  }
  return [...groups].map(([id, members]) => ({ id, tools: members }));
}
