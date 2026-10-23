import { ORGANIZATION_TOOLS, ORGANIZATION_TOOL_NAMES, withOrganizationFinalResponse, withOrganizationHistory } from "./conversation-organization.js";
import { buildCreateTaskFunctionTool, PROJECT_MASTER_TOOL_NAMES } from "./project-master.js";
import { SUBAGENT_TOOL_NAMES } from "./subagents.js";
import { SWARM_FUNCTION_TOOLS } from "./swarm.js";
import type { FunctionTool, Tool } from "openai/resources/responses/responses";
import type { TaskMessageToolOptions } from "../agent/types.js";
import { isToolGroupLoaded } from "./tool-groups.js";
import { COMPUTER_LOCAL_SHELL_TOOL_NAME, COMPUTER_RESPONSE_FUNCTION_TOOLS } from "../computer/computer-tools.js";
import {
  INIT_SANDBOX_TOOL,
  buildRunShellFunctionTool,
  CONTEXT_V2_FUNCTION_TOOLS,
  RESPONSE_FUNCTION_TOOLS,
  SEARCH_WEB_TOOL,
  WEB_SEARCH_TOOL
} from "./function-tools.js";
import {
  CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME,
  GET_CONTEXT_REMAINING_TOOL_NAME,
  HISTORY_LIST_ITEMS_TOOL_NAME,
  HISTORY_LIST_WINDOWS_TOOL_NAME,
  HISTORY_READ_ITEM_TOOL_NAME,
  HISTORY_SEARCH_CONTENTS_TOOL_NAME,
  CREATE_PROJECT_CANVAS_TOOL_NAME,
  SHOW_CANVAS_TOOL_NAME,
  CREATE_SUBTASK_TOOL_NAME,
  EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
  FINAL_RESPONSE_TOOL_NAME,
  GET_LIVE_SYNC_STATUS_TOOL_NAME,
  LIST_LIVE_SYNC_FILES_TOOL_NAME,
  MEMORY_SEARCH_TOOL_NAME,
  NEW_CONTEXT_TOOL_NAME,
  NOTES_APPEND_TO_FILE_TOOL_NAME,
  NOTES_LIST_FILES_BY_PREFIX_TOOL_NAME,
  NOTES_READ_FILE_TOOL_NAME,
  NOTES_SEARCH_CONTENTS_TOOL_NAME,
  NOTES_WRITE_FILE_TOOL_NAME,
  PULL_LIVE_SYNC_FILE_TOOL_NAME,
  PUSH_LIVE_SYNC_FILE_TOOL_NAME,
  SEARCH_LIVE_SYNC_FOLDER_TOOL_NAME,
  REQUEST_CLARIFICATION_TOOL_NAME,
  REFRESH_GH_TOKEN_TOOL_NAME,
  RUN_SHELL_TOOL_NAME,
  SHELL_SESSION_TOOL_NAME,
  SCHEDULE_TASK_TOOL_NAME,
  QUERY_TASKS_TOOL_NAME,
  START_LONG_HORIZON_TASK_TOOL_NAME,
  START_SUBTASK_TOOL_NAME,
  STOP_TASK_TOOL_NAME,
  SUBMIT_RESPONSE_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
  VIEW_TASK_HISTORY_TOOL_NAME,
  VIEW_PDF_FILE_TOOL_NAME,
  WAIT_TOOL_NAME,
  type ResponseToolAvailability
} from "./shared.js";

function isToolEnabled(
  tool: FunctionTool,
  options: TaskMessageToolOptions,
  availability: ResponseToolAvailability
): boolean {
  if (availability.contextManagementVersion === "v2" && availability.contextRecoveryPhase && availability.contextRecoveryPhase !== "normal") {
    if (availability.contextRecoveryPhase === "needs_note") {
      return tool.name === NOTES_APPEND_TO_FILE_TOOL_NAME || tool.name === NOTES_WRITE_FILE_TOOL_NAME;
    }
    return tool.name === NEW_CONTEXT_TOOL_NAME;
  }
  if (!isToolGroupLoaded(tool.name, availability.loadedToolGroups)) {
    return false;
  }

  if (
    tool.name === CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME
    || tool.name === CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME
  ) {
    return availability.contextManagementVersion === "v1";
  }

  if ([
    NEW_CONTEXT_TOOL_NAME,
    GET_CONTEXT_REMAINING_TOOL_NAME,
    HISTORY_LIST_WINDOWS_TOOL_NAME,
    HISTORY_LIST_ITEMS_TOOL_NAME,
    HISTORY_READ_ITEM_TOOL_NAME,
    HISTORY_SEARCH_CONTENTS_TOOL_NAME,
    NOTES_LIST_FILES_BY_PREFIX_TOOL_NAME,
    NOTES_READ_FILE_TOOL_NAME,
    NOTES_SEARCH_CONTENTS_TOOL_NAME,
    NOTES_APPEND_TO_FILE_TOOL_NAME,
    NOTES_WRITE_FILE_TOOL_NAME
  ].includes(tool.name)) {
    return availability.contextManagementVersion === "v2";
  }

  if (tool.name === FINAL_RESPONSE_TOOL_NAME) {
    return availability.allowFinalResponse !== false;
  }

  if (tool.name === SHELL_SESSION_TOOL_NAME) {
    return availability.allowPersistentShellSessions === true;
  }

  if (tool.name === WAIT_TOOL_NAME) {
    return availability.allowWaitTool === true;
  }

  if (tool.name === STOP_TASK_TOOL_NAME) {
    return availability.allowStopTask === true;
  }

  if (tool.name === VIEW_PDF_FILE_TOOL_NAME) {
    return availability.allowPdfFileTool !== false;
  }

  if (tool.name === REFRESH_GH_TOKEN_TOOL_NAME) {
    return availability.allowRefreshGitHubToken === true;
  }

  if (tool.name === START_LONG_HORIZON_TASK_TOOL_NAME) {
    return availability.allowStartLongHorizonTask === true;
  }

  if (tool.name === REQUEST_CLARIFICATION_TOOL_NAME) {
    return availability.allowRequestClarification === true;
  }

  if (tool.name === SUBMIT_RESPONSE_TOOL_NAME) {
    return availability.allowSubmitResponse === true;
  }

  if (tool.name === SUBMIT_REVIEW_TOOL_NAME) {
    return availability.allowSubmitReview === true;
  }

  if (tool.name === MEMORY_SEARCH_TOOL_NAME) {
    return options.memorySearch === true;
  }

  if (tool.name === VIEW_TASK_HISTORY_TOOL_NAME && availability.newMessageOrganizationEnabled) return true;

  if (tool.name === QUERY_TASKS_TOOL_NAME || tool.name === VIEW_TASK_HISTORY_TOOL_NAME) {
    return availability.allowTaskHistoryTools !== false || availability.allowProjectMasterTools === true;
  }

  if ((PROJECT_MASTER_TOOL_NAMES as readonly string[]).includes(tool.name)) {
    return availability.allowProjectMasterTools === true;
  }

  if (
    tool.name === LIST_LIVE_SYNC_FILES_TOOL_NAME
    || tool.name === GET_LIVE_SYNC_STATUS_TOOL_NAME
    || tool.name === PULL_LIVE_SYNC_FILE_TOOL_NAME
    || tool.name === PUSH_LIVE_SYNC_FILE_TOOL_NAME
  ) {
    return availability.allowLiveSyncTools === true;
  }

  if (tool.name === SEARCH_LIVE_SYNC_FOLDER_TOOL_NAME) {
    return availability.allowLiveSyncFolderSearch === true;
  }

  if (tool.name === CREATE_PROJECT_CANVAS_TOOL_NAME || tool.name === SHOW_CANVAS_TOOL_NAME) {
    return availability.allowCanvasTools === true;
  }

  if (tool.name === SCHEDULE_TASK_TOOL_NAME || tool.name === EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME) {
    return options.scheduleTask === true && availability.allowScheduleTools === true;
  }

  if (tool.name === CREATE_SUBTASK_TOOL_NAME || tool.name === START_SUBTASK_TOOL_NAME) {
    return false; // Legacy handlers remain available for replay, but new turns use subagent tools.
  }

  if ((SUBAGENT_TOOL_NAMES as readonly string[]).includes(tool.name)) {
    return options.subtasks === true && availability.allowSubtaskTools !== false;
  }

  if (COMPUTER_RESPONSE_FUNCTION_TOOLS.some((computerTool) => computerTool.name === tool.name)) {
    if (tool.name === COMPUTER_LOCAL_SHELL_TOOL_NAME) {
      return options.computerUse === true && availability.allowComputerLocalShell === true;
    }

    return options.computerUse === true && availability.allowComputerVisualTools === true;
  }

  return true;
}

// The Master only coordinates: it delegates work to tasks and never gets a shell, patching, web, or skills.
const PROJECT_MASTER_ALLOWED_TOOL_NAMES = new Set<string>([
  ...PROJECT_MASTER_TOOL_NAMES,
  QUERY_TASKS_TOOL_NAME,
  VIEW_TASK_HISTORY_TOOL_NAME,
  FINAL_RESPONSE_TOOL_NAME,
  MEMORY_SEARCH_TOOL_NAME,
  ...ORGANIZATION_TOOL_NAMES
]);

function isProjectMasterTool(tool: Tool): boolean {
  return tool.type === "function"
    && (PROJECT_MASTER_ALLOWED_TOOL_NAMES.has(tool.name) || CONTEXT_V2_FUNCTION_TOOLS.some((contextTool) => contextTool.name === tool.name));
}

export function buildResponseTools(
  options: TaskMessageToolOptions,
  skillTools: FunctionTool[],
  availability: ResponseToolAvailability = {}
): Tool[] {
  if (availability.contextManagementVersion === "v2" && availability.contextRecoveryPhase && availability.contextRecoveryPhase !== "normal") {
    return CONTEXT_V2_FUNCTION_TOOLS.filter((tool) => isToolEnabled(tool, options, availability));
  }

  if (availability.quickModeActive === true && availability.allowProjectMasterTools !== true) {
    return [...(availability.newMessageOrganizationEnabled
      ? [INIT_SANDBOX_TOOL, ...ORGANIZATION_TOOLS,
        ...RESPONSE_FUNCTION_TOOLS.filter((tool) => tool.name === VIEW_TASK_HISTORY_TOOL_NAME).map(withOrganizationHistory),
        ...RESPONSE_FUNCTION_TOOLS.filter((tool) => tool.name === FINAL_RESPONSE_TOOL_NAME && availability.allowFinalResponse !== false).map(withOrganizationFinalResponse)]
      : [INIT_SANDBOX_TOOL])];
  }

  const runShellTool = buildRunShellFunctionTool(availability.runShellMaxTimeoutSeconds);
  const tools: Tool[] = [
    ...(availability.newMessageOrganizationEnabled ? ORGANIZATION_TOOLS : []),
    ...RESPONSE_FUNCTION_TOOLS
      .filter((tool) => isToolEnabled(tool, options, availability))
      .map((tool) => {
        if (availability.newMessageOrganizationEnabled && tool.name === FINAL_RESPONSE_TOOL_NAME) return withOrganizationFinalResponse(tool);
        if (availability.newMessageOrganizationEnabled && tool.name === VIEW_TASK_HISTORY_TOOL_NAME) return withOrganizationHistory(tool);
        if (tool.name === RUN_SHELL_TOOL_NAME) {
          return runShellTool;
        }
        return tool;
      }),
    ...CONTEXT_V2_FUNCTION_TOOLS.filter((tool) => isToolEnabled(tool, options, availability)),
    ...COMPUTER_RESPONSE_FUNCTION_TOOLS.filter((tool) => isToolEnabled(tool, options, availability)),
    ...(availability.allowSwarmTools === true ? SWARM_FUNCTION_TOOLS : []),
    ...skillTools
  ];

  if (availability.allowProjectMasterTools === true) {
    return tools.filter(isProjectMasterTool).map((tool) => tool.type === "function" && tool.name === "create_task"
      ? buildCreateTaskFunctionTool(availability.projectMasterTaskRouter ?? null)
      : tool);
  }

  if (options.webSearch) {
    tools.push(availability.useClaudeWebSearch === true ? SEARCH_WEB_TOOL : WEB_SEARCH_TOOL);
  }

  return tools;
}
