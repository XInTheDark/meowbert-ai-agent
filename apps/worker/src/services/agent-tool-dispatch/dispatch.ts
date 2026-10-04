import { handleSearchWeb } from "./handlers/web-search.js";
import { handleConversationOrganization } from "./handlers/conversation-organization.js";
import { handleSubagentTool } from "./handlers/subagents.js";
import { handleProjectMasterTool } from "./handlers/project-master.js";
import { assertSubagentsFinished } from "../subagents/mail.js";
import type {
  ResponseCustomToolCall,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputMessage,
  ResponseOutputItem
} from "openai/resources/responses/responses";
import type { PlatformModelCompatibilityMode } from "@meowbert/shared";
import { parseXmlToolCalls, stripXmlToolCalls } from "@meowbert/shared";
import {
  APPLY_PATCH_TOOL_NAME,
  SWARM_BUDGET_STATUS_TOOL_NAME,
  SWARM_CANCEL_NODE_TOOL_NAME,
  SWARM_GRANT_BUDGET_TOOL_NAME,
  SWARM_PAUSE_TOOL_NAME,
  SWARM_MANAGE_TOOL_NAME,
  SWARM_RECORD_FINAL_REVIEW_TOOL_NAME,
  SWARM_RECORD_REVIEW_TOOL_NAME,
  SWARM_SPAWN_NODE_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME,
  CREATE_CHANNEL_TOOL_NAME,
  CREATE_INTERACTIVE_CANVAS_TOOL_NAME,
  CREATE_SUBTASK_TOOL_NAME,
  EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
  ENABLE_SKILL_TOOL_NAME,
  FINAL_RESPONSE_TOOL_NAME,
  finalResponseArgumentsSchema,
  MARK_ARTIFACT_TOOL_NAME,
  GET_LIVE_SYNC_STATUS_TOOL_NAME,
  INIT_SANDBOX_TOOL_NAME,
  LIST_SKILLS_TOOL_NAME,
  LIST_CHANNELS_TOOL_NAME,
  LIST_LIVE_SYNC_FILES_TOOL_NAME,
  MEMORY_SEARCH_TOOL_NAME,
  SEARCH_WEB_TOOL_NAME,
  PULL_LIVE_SYNC_FILE_TOOL_NAME,
  PUSH_LIVE_SYNC_FILE_TOOL_NAME,
  REQUEST_CLARIFICATION_TOOL_NAME,
  READ_CHANNEL_TOOL_NAME,
  REFRESH_INBOX_TOOL_NAME,
  REFRESH_GH_TOKEN_TOOL_NAME,
  RUN_SHELL_TOOL_NAME,
  SHELL_SESSION_TOOL_NAME,
  SCHEDULE_TASK_TOOL_NAME,
  LEGACY_SEARCH_TASK_HISTORY_TOOL_NAME,
  QUERY_TASKS_TOOL_NAME,
  SEND_CHANNEL_MESSAGE_TOOL_NAME,
  SUBMIT_SWARM_OUTPUT_TOOL_NAME,
  START_LONG_HORIZON_TASK_TOOL_NAME,
  START_SUBTASK_TOOL_NAME,
  STOP_TASK_TOOL_NAME,
  SUBMIT_RESPONSE_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
  VIEW_IMAGE_TOOL_NAME,
  VIEW_PDF_FILE_TOOL_NAME,
  VIEW_TASK_HISTORY_TOOL_NAME,
  WAIT_TOOL_NAME
} from "../agent-tools/index.js";
import { isFunctionCallItem, parseToolArguments, toContinuityInputItem } from "../agent/utils.js";
import { hasApprovedSwarmFinalReview } from "../task-workflows/service.js";
import {
  isApplyPatchCallItem,
  isApplyPatchCustomToolCallItem,
  type ApplyPatchCustomToolCall,
  type ApplyPatchFunctionToolCall
} from "../agent/apply-patch.js";
import { reportUnhandledToolFailure } from "./events.js";
import { handleApplyPatch, type ApplyPatchResult } from "./handlers/apply-patch.js";
import { handleExec } from "./handlers/exec.js";
import { EXEC_TOOL_NAME } from "../code-mode/exec-tool.js";
import { handleSearchTools } from "./handlers/search-tools.js";
import { SEARCH_TOOLS_TOOL_NAME } from "../code-mode/search-tools-tool.js";
import { handleMarkArtifact } from "./handlers/artifacts.js";
import { handleComputerToolCall } from "./handlers/computer.js";
import { handleContextManagementTool } from "./handlers/context-management.js";
import { handleContextManagementV2Tool, isContextManagementV2Tool } from "./handlers/context-management-v2.js";
import { handleViewImage, handleViewPdf } from "./handlers/files.js";
import { handleQueryTasks, handleViewTaskHistory, handleMemorySearch } from "./handlers/history.js";
import { handleCreateInteractiveCanvas } from "./handlers/interactive-canvas.js";
import {
  handleGetLiveSyncStatus,
  handleListLiveSyncFiles,
  handlePullLiveSyncFile,
  handlePushLiveSyncFile
} from "./handlers/live-sync.js";
import {
  handleFinalResponse,
  handleRefreshGitHubToken,
  handleRunShell,
} from "./handlers/shell.js";
import { handleShellSession } from "./handlers/persistent-shell.js";
import { handleWaitTool } from "./handlers/wait.js";
import { handleEnableSkill, handleListSkills, handleSkillToolCall } from "./handlers/skills.js";
import {
  handleEditCurrentTaskSchedule,
  handleSwarmPauseTool,
  handleScheduleTask,
  handleStopTask
} from "./handlers/scheduling.js";
import { handleCreateSubtask, handleStartSubtask } from "./handlers/subtasks.js";
import {
  handleCreateChannel,
  handleSwarmManage,
  handleSwarmBudgetStatus,
  handleSwarmCancelNode,
  handleSwarmGrantBudget,
  handleSwarmRecordFinalReview,
  handleSwarmRecordReview,
  handleSwarmSpawnNode,
  handleListChannels,
  handleReadChannel,
  handleRequestClarification,
  handleRefreshInbox,
  handleSendChannelMessage,
  handleStartLongHorizonTask,
  handleSubmitResponse,
  handleSubmitReview,
  handleSubmitSwarmOutput
} from "./handlers/workflows.js";
import {
  hasApplyPatchCallOutput,
  hasCustomToolOutput,
  hasFunctionCallOutput,
  recordApplyPatchCallOutput,
  recordCustomToolCallOutput,
  recordFunctionCallResult
} from "./state.js";
import { toolErrorResult, type ToolCallResult } from "./tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchResult, ToolDispatchState } from "./types.js";
import { recordContextItems } from "../context-management-v2/index.js";
import { trackRepeatedToolCall } from "./repeated-tool-calls.js";

function invalidatePendingSwarmSendAfterRefresh(ctx: ToolDispatchContext): void {
  if (ctx.workflowContext?.workflowType !== "agent_swarm") {
    return;
  }

  ctx.workflowContext.runtime.pendingChannelMessageSendAfterRefresh = false;
}

function isForcedFinalResponse(outputItem: ResponseFunctionToolCall): boolean {
  const parsed = parseToolArguments(FINAL_RESPONSE_TOOL_NAME, outputItem.arguments, finalResponseArgumentsSchema);
  return parsed.ok && parsed.value.force === true;
}

function isCustomToolCallItem(outputItem: ResponseOutputItem): outputItem is ResponseCustomToolCall {
  return outputItem.type === "custom_tool_call"
    && typeof outputItem.call_id === "string"
    && typeof outputItem.name === "string";
}

async function dispatchFunctionToolCall(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  switch (outputItem.name) {
    case EXEC_TOOL_NAME:
      return handleExec(outputItem, ctx, state, dispatchFunctionToolCall);

    case SEARCH_TOOLS_TOOL_NAME:
      return handleSearchTools(outputItem, ctx, state);

    case "update_conversation_outline":
    case "update_conversation_map":
      return handleConversationOrganization(outputItem, state);
    case "spawn_subagent":
    case "send_subagent_message":
    case "followup_subagent":
    case "wait_subagent":
    case "list_subagents":
    case "interrupt_subagent":
      return handleSubagentTool(outputItem, ctx, state);
    case "create_task":
    case "message_task":
    case "cancel_task":
    case "listen_to_tasks":
      return handleProjectMasterTool(outputItem, ctx, state);
    case APPLY_PATCH_TOOL_NAME:
      return handleApplyPatch(outputItem as ApplyPatchFunctionToolCall, ctx, state);

    case RUN_SHELL_TOOL_NAME:
      return handleRunShell(outputItem, ctx, state);

    case SHELL_SESSION_TOOL_NAME:
      return handleShellSession(outputItem, ctx, state);

    case CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME:
    case CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME:
      return handleContextManagementTool(outputItem, ctx, state);

    case REFRESH_GH_TOKEN_TOOL_NAME:
      return handleRefreshGitHubToken(outputItem, ctx, state);

    case FINAL_RESPONSE_TOOL_NAME:
      if (ctx.runToolOptions.subtasks) await assertSubagentsFinished(ctx.taskId);
      if (
        ctx.workflowContext?.workflowType === "agent_swarm"
        && (
          ctx.runMode !== "agent_swarm_leader"
          || ctx.workflowContext.taskId !== ctx.workflowContext.workflowTaskId
        )
      ) {
        return toolErrorResult("Only the top Agent Swarm leader can call final_response. Complete your swarm work with send_channel_message or submit_swarm_output.");
      }
      if (
        ctx.workflowContext?.workflowType === "agent_swarm"
        && ctx.runMode === "agent_swarm_leader"
        && (ctx.workflowContext.swarm?.pendingNestedSwarmNodeIds?.length ?? 0) > 0
        && !isForcedFinalResponse(outputItem)
      ) {
        return toolErrorResult(`Started nested swarms have not published their output: ${ctx.workflowContext.swarm!.pendingNestedSwarmNodeIds!.join(", ")}.`);
      }
      if (
        ctx.workflowContext?.workflowType === "long_horizon"
        && (
          ctx.runMode !== "long_horizon_main"
          || (ctx.workflowContext.longHorizon?.enableReviewPhase !== false && ctx.workflowContext.phase !== "approved")
        )
      ) {
        return toolErrorResult("Long Horizon review approval is required before final_response. Continue the workflow with its available action.");
      }
      if (
        ctx.workflowContext?.workflowType === "agent_swarm"
        && (ctx.runMode !== "agent_swarm_leader" || !hasApprovedSwarmFinalReview(ctx.workflowContext))
        && !isForcedFinalResponse(outputItem)
      ) {
        return toolErrorResult("The final swarm review is missing. Record it first, or call final_response again with force: true to deliver now.");
      }
      return handleFinalResponse(outputItem, state);

    case MARK_ARTIFACT_TOOL_NAME:
      return handleMarkArtifact(outputItem, ctx, state);

    case CREATE_INTERACTIVE_CANVAS_TOOL_NAME:
      return handleCreateInteractiveCanvas(outputItem, ctx, state);

    case INIT_SANDBOX_TOOL_NAME: {
      const result = await ctx.initializeSandbox?.();
      return {
        output: {
          ok: true,
          alreadyInitialized: result?.alreadyInitialized === true,
          message: result?.alreadyInitialized === true
            ? "Sandbox was already initialized. Full tools are available."
            : "Sandbox initialized. Full tools are available on the next turn."
        }
      };
    }

    case WAIT_TOOL_NAME:
      return handleWaitTool(outputItem, ctx, state);

    case SWARM_PAUSE_TOOL_NAME:
      return handleSwarmPauseTool(outputItem, ctx, state);

    case SWARM_MANAGE_TOOL_NAME:
      return handleSwarmManage(outputItem, ctx, state);

    case SWARM_BUDGET_STATUS_TOOL_NAME:
      return handleSwarmBudgetStatus(outputItem, ctx, state);

    case SWARM_SPAWN_NODE_TOOL_NAME:
      return handleSwarmSpawnNode(outputItem, ctx, state);

    case SWARM_GRANT_BUDGET_TOOL_NAME:
      return handleSwarmGrantBudget(outputItem, ctx, state);

    case SWARM_CANCEL_NODE_TOOL_NAME:
      return handleSwarmCancelNode(outputItem, ctx, state);

    case SWARM_RECORD_REVIEW_TOOL_NAME:
      return handleSwarmRecordReview(outputItem, ctx, state);

    case SWARM_RECORD_FINAL_REVIEW_TOOL_NAME:
      return handleSwarmRecordFinalReview(outputItem, ctx, state);

    case STOP_TASK_TOOL_NAME:
      return handleStopTask(outputItem, ctx, state);

    case VIEW_IMAGE_TOOL_NAME:
      return handleViewImage(outputItem, ctx, state);

    case VIEW_PDF_FILE_TOOL_NAME:
      if (ctx.compatibilityModes?.includes("disablePdfFile")) {
        throw new Error("view_pdf_file is disabled for this model.");
      }
      return handleViewPdf(outputItem, ctx, state);

    case QUERY_TASKS_TOOL_NAME:
    case LEGACY_SEARCH_TASK_HISTORY_TOOL_NAME:
      return handleQueryTasks(outputItem, ctx, state);

    case VIEW_TASK_HISTORY_TOOL_NAME:
      return handleViewTaskHistory(outputItem, ctx, state);

    case MEMORY_SEARCH_TOOL_NAME:
      return handleMemorySearch(outputItem, ctx, state);

    case SEARCH_WEB_TOOL_NAME:
      return handleSearchWeb(outputItem, ctx, state);

    case LIST_LIVE_SYNC_FILES_TOOL_NAME:
      return handleListLiveSyncFiles(outputItem, ctx, state);

    case GET_LIVE_SYNC_STATUS_TOOL_NAME:
      return handleGetLiveSyncStatus(outputItem, ctx, state);

    case PULL_LIVE_SYNC_FILE_TOOL_NAME:
      return handlePullLiveSyncFile(outputItem, ctx, state);

    case PUSH_LIVE_SYNC_FILE_TOOL_NAME:
      return handlePushLiveSyncFile(outputItem, ctx, state);

    case LIST_SKILLS_TOOL_NAME:
      return handleListSkills(outputItem, ctx, state);

    case ENABLE_SKILL_TOOL_NAME:
      return handleEnableSkill(outputItem, ctx, state);

    case SCHEDULE_TASK_TOOL_NAME:
      return handleScheduleTask(outputItem, ctx, state);

    case EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME:
      return handleEditCurrentTaskSchedule(outputItem, ctx, state);

    case CREATE_SUBTASK_TOOL_NAME:
      return handleCreateSubtask(outputItem, ctx, state);

    case START_SUBTASK_TOOL_NAME:
      return handleStartSubtask(outputItem, ctx, state);

    case START_LONG_HORIZON_TASK_TOOL_NAME:
      return handleStartLongHorizonTask(outputItem, ctx, state);

    case REQUEST_CLARIFICATION_TOOL_NAME:
      return handleRequestClarification(outputItem, ctx);

    case SUBMIT_RESPONSE_TOOL_NAME:
      return handleSubmitResponse(outputItem, ctx, state);

    case SUBMIT_REVIEW_TOOL_NAME:
      return handleSubmitReview(outputItem, ctx, state);

    case REFRESH_INBOX_TOOL_NAME:
      return handleRefreshInbox(outputItem, ctx, state);

    case LIST_CHANNELS_TOOL_NAME:
      return handleListChannels(outputItem, ctx, state);

    case READ_CHANNEL_TOOL_NAME:
      return handleReadChannel(outputItem, ctx, state);

    case CREATE_CHANNEL_TOOL_NAME:
      return handleCreateChannel(outputItem, ctx, state);

    case SEND_CHANNEL_MESSAGE_TOOL_NAME:
      return handleSendChannelMessage(outputItem, ctx, state);

    case SUBMIT_SWARM_OUTPUT_TOOL_NAME:
      return handleSubmitSwarmOutput(outputItem, ctx, state);

    default:
      return await handleComputerToolCall(outputItem, ctx, state)
        ?? await handleSkillToolCall(outputItem, ctx, state)
        ?? toolErrorResult(`Unknown tool: ${outputItem.name}`);
  }
}

async function dispatchCustomToolCall(
  outputItem: ApplyPatchCustomToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ApplyPatchResult> {
  switch (outputItem.name) {
    case APPLY_PATCH_TOOL_NAME:
      return handleApplyPatch(outputItem, ctx, state);

    default:
      throw new Error(`Unknown custom tool: ${outputItem.name}`);
  }
}

async function recordInContext(ctx: ToolDispatchContext, items: ResponseInputItem[]): Promise<void> {
  if (ctx.contextManagementV2 && items.length > 0) {
    await recordContextItems(ctx.contextManagementV2, items);
  }
}

function preprocessXmlToolCalls(
  outputItems: ResponseOutputItem[],
  compatibilityModes: PlatformModelCompatibilityMode[]
): ResponseOutputItem[] {
  if (!compatibilityModes.includes("parseXMLToolCalls")) {
    return outputItems;
  }

  const result: ResponseOutputItem[] = [];
  for (const item of outputItems) {
    result.push(item);
    if (item.type === "message") {
      const message = item as ResponseOutputMessage;
      if (message.content) {
        for (const part of message.content) {
          if (part.type === "output_text" && typeof part.text === "string") {
            const parsedCalls = parseXmlToolCalls(part.text);
            if (parsedCalls.length > 0) {
              // Strip XML blocks from the original text so the model doesn't see duplicates
              part.text = stripXmlToolCalls(part.text);
              // Inject synthetic function_call items
              for (const call of parsedCalls) {
                result.push({
                  type: "function_call",
                  name: call.name,
                  arguments: JSON.stringify(call.arguments),
                  call_id: `xml_${item.id ?? Date.now()}_${result.length}`,
                } as ResponseFunctionToolCall);
              }
            }
          }
        }
      }
    }
  }
  return result;
}

function hasRecordedToolOutput(item: ResponseOutputItem, state: ToolDispatchState): boolean {
  return (isApplyPatchCustomToolCallItem(item) && hasCustomToolOutput(state, item.call_id))
    || (isFunctionCallItem(item) && hasFunctionCallOutput(state, item.call_id))
    || (isApplyPatchCallItem(item) && hasApplyPatchCallOutput(state, item.call_id));
}

// Record the whole response before any tool runs, so a parallel batch is replayed as all of its
// calls followed by all of its outputs. Interleaving each output after its own call splits one
// assistant turn into several, which session-resuming proxies (e.g. Meridian) cannot match to the
// turn they returned, and they fall back to re-sending the whole conversation uncached.
async function recordResponseItems(
  items: ResponseOutputItem[],
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  const recorded: ResponseInputItem[] = [];
  for (const item of items) {
    if (hasRecordedToolOutput(item, state)) {
      continue;
    }
    const isContextTool = isFunctionCallItem(item) && ctx.contextManagementV2 && isContextManagementV2Tool(item.name);
    const inputItem = isContextTool
      ? item as unknown as ResponseInputItem
      : toContinuityInputItem(item, ctx.compatibilityModes);
    if (!inputItem) {
      continue;
    }
    state.conversationItems.push(inputItem);
    state.runPersistedItems.push(inputItem);
    recorded.push(inputItem);
  }
  if (ctx.contextManagementV2 && recorded.length > 0) {
    await recordContextItems(ctx.contextManagementV2, recorded);
  }
}

export async function dispatchResponseOutput(
  outputItems: ResponseOutputItem[],
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolDispatchResult> {
  // Preprocess: parse XML tool calls from message text if compatibility mode is active
  const effectiveItems = preprocessXmlToolCalls(outputItems, ctx.compatibilityModes ?? []);

  await ctx.assertNotCancelled();
  await recordResponseItems(effectiveItems, ctx, state);
  let sawToolCall = false;
  let sawFunctionToolCall = false;
  let finalResponse: ToolDispatchResult["finalResponse"] = null;
  let waitRequest: ToolDispatchResult["waitRequest"] = null;
  let stopRequest: ToolDispatchResult["stopRequest"] = null;
  let workflowPause: ToolDispatchResult["workflowPause"] = null;

  for (const rawOutputItem of effectiveItems) {
    const outputItem = rawOutputItem;
    await ctx.assertNotCancelled();

    if (isApplyPatchCustomToolCallItem(outputItem) && hasCustomToolOutput(state, outputItem.call_id)) {
      sawToolCall = true;
      sawFunctionToolCall = true;
      continue;
    }

    if (isFunctionCallItem(outputItem) && hasFunctionCallOutput(state, outputItem.call_id)) {
      sawToolCall = true;
      sawFunctionToolCall = true;
      continue;
    }

    if (isApplyPatchCallItem(outputItem) && hasApplyPatchCallOutput(state, outputItem.call_id)) {
      sawToolCall = true;
      continue;
    }

    const repeatedCallReminder = isFunctionCallItem(outputItem)
      ? trackRepeatedToolCall(state, outputItem.name, outputItem.arguments)
      : null;
    if (outputItem.type === "custom_tool_call" || outputItem.type === "web_search_call") {
      state.repeatedToolCall = undefined;
    }

    if (isFunctionCallItem(outputItem) && ctx.contextManagementV2 && isContextManagementV2Tool(outputItem.name)) {
      sawToolCall = true;
      sawFunctionToolCall = true;
      let result: ToolCallResult;
      try {
        result = await handleContextManagementV2Tool(outputItem, ctx, state);
      } catch (error) {
        result = toolErrorResult(error instanceof Error ? error.message : String(error));
        console.info("[context-management-v2]", JSON.stringify({
          version: "v2",
          failureClass: error instanceof Error ? error.name : "unknown"
        }));
      }
      await recordInContext(ctx, recordFunctionCallResult(state, outputItem.call_id, outputItem.name, result));
      continue;
    }

    if (outputItem.type === "web_search_call") {
      sawToolCall = true;
      invalidatePendingSwarmSendAfterRefresh(ctx);
      continue;
    }

    if (isApplyPatchCallItem(outputItem)) {
      sawToolCall = true;
      invalidatePendingSwarmSendAfterRefresh(ctx);
      let result: ApplyPatchResult;
      try {
        result = await handleApplyPatch(outputItem, ctx, state);
      } catch (error) {
        result = { output: await reportUnhandledToolFailure(APPLY_PATCH_TOOL_NAME, outputItem.call_id, ctx, error), status: "failed" };
      }
      await recordInContext(ctx, recordApplyPatchCallOutput(state, outputItem.call_id, result.output, result.status));
      continue;
    }

    if (isApplyPatchCustomToolCallItem(outputItem)) {
      sawToolCall = true;
      sawFunctionToolCall = true;
      invalidatePendingSwarmSendAfterRefresh(ctx);
      await ctx.assertNotCancelled();

      let output: string;
      try {
        output = (await dispatchCustomToolCall(outputItem, ctx, state)).output;
      } catch (error) {
        output = `Error: ${await reportUnhandledToolFailure(outputItem.name, outputItem.call_id, ctx, error)}`;
      }
      await recordInContext(ctx, recordCustomToolCallOutput(state, outputItem.call_id, output));

      await ctx.assertNotCancelled();
      continue;
    }

    if (isCustomToolCallItem(outputItem)) {
      sawToolCall = true;
      sawFunctionToolCall = true;
      invalidatePendingSwarmSendAfterRefresh(ctx);
      if (!hasCustomToolOutput(state, outputItem.call_id)) {
        await recordInContext(ctx, recordCustomToolCallOutput(state, outputItem.call_id, `Error: Unsupported custom tool: ${outputItem.name}`));
      }
      continue;
    }

    if (!isFunctionCallItem(outputItem)) {
      continue;
    }

    sawToolCall = true;
    sawFunctionToolCall = true;
    if (outputItem.name !== SEND_CHANNEL_MESSAGE_TOOL_NAME) {
      invalidatePendingSwarmSendAfterRefresh(ctx);
    }
    await ctx.assertNotCancelled();

    try {
      let result: ToolCallResult;
      try {
        result = await dispatchFunctionToolCall(outputItem, ctx, state);
      } catch (error) {
        result = toolErrorResult(await reportUnhandledToolFailure(outputItem.name, outputItem.call_id, ctx, error));
      }
      await recordInContext(ctx, recordFunctionCallResult(state, outputItem.call_id, outputItem.name, result));
      if (repeatedCallReminder) {
        const reminder = { role: "developer" as const, content: repeatedCallReminder };
        state.conversationItems.push(reminder);
        state.runPersistedItems.push(reminder);
        await recordInContext(ctx, [reminder]);
      }
      if (result.finalResponse) {
        (state.finalResponseSegments ??= []).push(result.finalResponse);
        finalResponse = result.finalResponse;
      }
      if (result.waitRequest) {
        waitRequest = result.waitRequest;
      }
      if (result.stopRequest) {
        stopRequest = result.stopRequest;
      }
      if (result.workflowPause) {
        workflowPause = result.workflowPause;
      }
    } finally {
      if (outputItem.name === SEND_CHANNEL_MESSAGE_TOOL_NAME) {
        invalidatePendingSwarmSendAfterRefresh(ctx);
      }
    }

    await ctx.assertNotCancelled();
  }

  return { sawToolCall, sawFunctionToolCall, finalResponse, waitRequest, stopRequest, workflowPause };
}
