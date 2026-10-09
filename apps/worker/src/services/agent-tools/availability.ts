import { ORGANIZATION_TOOLS, ORGANIZATION_TOOL_NAMES, withOrganizationFinalResponse, withOrganizationHistory } from "./conversation-organization.js";
import { PROJECT_MASTER_TOOL_NAMES } from "./project-master.js";
import { SUBAGENT_TOOL_NAMES } from "./subagents.js";
import type { FunctionTool, Tool } from "openai/resources/responses/responses";
import type { TaskMessageToolOptions } from "../agent/types.js";
import { isToolGroupLoaded } from "./tool-groups.js";
import { COMPUTER_LOCAL_SHELL_TOOL_NAME, COMPUTER_RESPONSE_FUNCTION_TOOLS } from "../computer/computer-tools.js";
import {
  INIT_SANDBOX_TOOL,
  buildSwarmPauseFunctionTool,
  buildUnbudgetedSwarmManageFunctionTool,
  buildRunShellFunctionTool,
  CONTEXT_V2_FUNCTION_TOOLS,
  RESPONSE_FUNCTION_TOOLS,
  SEARCH_WEB_TOOL,
  WEB_SEARCH_TOOL
} from "./function-tools.js";
import {
  SWARM_PAUSE_TOOL_NAME,
  SWARM_MANAGE_TOOL_NAME,
  ASSIGN_WORKER_TOOL_NAME,
  SWARM_BUDGET_STATUS_TOOL_NAME,
  SWARM_CANCEL_NODE_TOOL_NAME,
  SWARM_GRANT_BUDGET_TOOL_NAME,
  SWARM_RECORD_FINAL_REVIEW_TOOL_NAME,
  SWARM_RECORD_REVIEW_TOOL_NAME,
  SWARM_SPAWN_NODE_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME,
  GET_CONTEXT_REMAINING_TOOL_NAME,
  HISTORY_LIST_ITEMS_TOOL_NAME,
  HISTORY_LIST_WINDOWS_TOOL_NAME,
  HISTORY_READ_ITEM_TOOL_NAME,
  HISTORY_SEARCH_CONTENTS_TOOL_NAME,
  CREATE_CHANNEL_TOOL_NAME,
  CREATE_INTERACTIVE_CANVAS_TOOL_NAME,
  CREATE_SUBTASK_TOOL_NAME,
  EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
  FINAL_RESPONSE_TOOL_NAME,
  GET_LIVE_SYNC_STATUS_TOOL_NAME,
  LIST_CHANNELS_TOOL_NAME,
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
  REQUEST_CLARIFICATION_TOOL_NAME,
  READ_CHANNEL_TOOL_NAME,
  REFRESH_GH_TOKEN_TOOL_NAME,
  RUN_SHELL_TOOL_NAME,
  SHELL_SESSION_TOOL_NAME,
  SCHEDULE_TASK_TOOL_NAME,
  QUERY_TASKS_TOOL_NAME,
  SEND_CHANNEL_MESSAGE_TOOL_NAME,
  SUBMIT_SWARM_OUTPUT_TOOL_NAME,
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

  if (tool.name === SWARM_PAUSE_TOOL_NAME) {
    return availability.allowSwarmPauseTool === true;
  }

  if (tool.name === SWARM_MANAGE_TOOL_NAME || tool.name === ASSIGN_WORKER_TOOL_NAME) {
    return availability.allowSwarmManageTool === true;
  }

  if (tool.name === SWARM_BUDGET_STATUS_TOOL_NAME) {
    return availability.allowSwarmTools === true && availability.allowSwarmBudgetTools === true;
  }

  if (
    tool.name === SWARM_SPAWN_NODE_TOOL_NAME
    || tool.name === SWARM_GRANT_BUDGET_TOOL_NAME
    || tool.name === SWARM_CANCEL_NODE_TOOL_NAME
  ) {
    return availability.allowSwarmManageTool === true && availability.allowSwarmBudgetTools === true;
  }

  if (tool.name === SWARM_RECORD_REVIEW_TOOL_NAME) {
    return availability.allowSwarmReviewTool === true;
  }

  if (tool.name === SWARM_RECORD_FINAL_REVIEW_TOOL_NAME) {
    return availability.allowSwarmFinalReviewTool === true;
  }

  if (tool.name === SUBMIT_SWARM_OUTPUT_TOOL_NAME) {
    return availability.allowSwarmOutputTool === true;
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

  if (
    tool.name === LIST_CHANNELS_TOOL_NAME
    || tool.name === READ_CHANNEL_TOOL_NAME
    || tool.name === CREATE_CHANNEL_TOOL_NAME
    || tool.name === SEND_CHANNEL_MESSAGE_TOOL_NAME
  ) {
    return availability.allowSwarmTools === true;
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

  if (tool.name === CREATE_INTERACTIVE_CANVAS_TOOL_NAME) {
    return availability.allowInteractiveCanvasTools === true;
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

const TARGETED_SWARM_TOOL_NAMES = new Set([
  SWARM_PAUSE_TOOL_NAME,
  SWARM_MANAGE_TOOL_NAME,
  ASSIGN_WORKER_TOOL_NAME,
  SWARM_BUDGET_STATUS_TOOL_NAME,
  SWARM_SPAWN_NODE_TOOL_NAME,
  SWARM_GRANT_BUDGET_TOOL_NAME,
  SWARM_CANCEL_NODE_TOOL_NAME,
  SWARM_RECORD_REVIEW_TOOL_NAME,
  SWARM_RECORD_FINAL_REVIEW_TOOL_NAME,
  LIST_CHANNELS_TOOL_NAME,
  READ_CHANNEL_TOOL_NAME,
  CREATE_CHANNEL_TOOL_NAME,
  SEND_CHANNEL_MESSAGE_TOOL_NAME,
  SUBMIT_SWARM_OUTPUT_TOOL_NAME
]);

function withSwarmTarget(tool: FunctionTool, required: boolean): FunctionTool {
  if (!required || !TARGETED_SWARM_TOOL_NAMES.has(tool.name)) return tool;
  const parameters = tool.parameters as {
    properties: Record<string, unknown>;
    required: string[];
  };
  return {
    ...tool,
    parameters: {
      ...parameters,
      properties: {
        ...parameters.properties,
        target_swarm: {
          type: "string",
          enum: ["outer", "inner"],
          description: "Choose the outer swarm where you are a member, or the inner swarm you lead."
        }
      },
      required: [...parameters.required, "target_swarm"]
    }
  };
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
        return withSwarmTarget(
          tool.name === SWARM_PAUSE_TOOL_NAME
            ? buildSwarmPauseFunctionTool()
            : tool.name === SWARM_MANAGE_TOOL_NAME && availability.allowSwarmBudgetTools !== true
              ? buildUnbudgetedSwarmManageFunctionTool()
              : tool,
          availability.requireSwarmTarget === true
        );
      }),
    ...CONTEXT_V2_FUNCTION_TOOLS.filter((tool) => isToolEnabled(tool, options, availability)),
    ...COMPUTER_RESPONSE_FUNCTION_TOOLS.filter((tool) => isToolEnabled(tool, options, availability)),
    ...skillTools
  ];

  if (availability.allowProjectMasterTools === true) return tools.filter(isProjectMasterTool);

  if (options.webSearch) {
    tools.push(availability.useClaudeWebSearch === true ? SEARCH_WEB_TOOL : WEB_SEARCH_TOOL);
  }

  return tools;
}
