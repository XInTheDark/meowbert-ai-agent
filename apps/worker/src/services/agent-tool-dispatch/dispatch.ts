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
import { finishUnhandledToolFailure } from "./events.js";
import { handleApplyPatch } from "./handlers/apply-patch.js";
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
import { hasApplyPatchCallOutput, hasCustomToolOutput, hasFunctionCallOutput, pushCustomToolOutput, pushOutput } from "./state.js";
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
): Promise<Pick<ToolDispatchResult, "finalResponse" | "waitRequest" | "stopRequest" | "workflowPause">> {
  let finalResponse: ToolDispatchResult["finalResponse"] = null;
  let waitRequest: ToolDispatchResult["waitRequest"] = null;
  let stopRequest: ToolDispatchResult["stopRequest"] = null;
  let workflowPause: ToolDispatchResult["workflowPause"] = null;

  switch (outputItem.name) {
    case "update_conversation_outline":
    case "update_conversation_map":
      handleConversationOrganization(outputItem, state);
      break;
    case "spawn_subagent":
    case "send_subagent_message":
    case "followup_subagent":
    case "wait_subagent":
    case "list_subagents":
    case "interrupt_subagent":
      await handleSubagentTool(outputItem, ctx, state);
      break;
    case "create_task":
    case "message_task":
    case "cancel_task":
    case "listen_to_tasks":
      await handleProjectMasterTool(outputItem, ctx, state);
      break;
    case APPLY_PATCH_TOOL_NAME:
      await handleApplyPatch(outputItem as ApplyPatchFunctionToolCall, ctx, state);
      break;

    case RUN_SHELL_TOOL_NAME:
      await handleRunShell(outputItem, ctx, state);
      break;

    case SHELL_SESSION_TOOL_NAME:
      await handleShellSession(outputItem, ctx, state);
      break;

    case CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME:
    case CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME:
      await handleContextManagementTool(outputItem, ctx, state);
      break;

    case REFRESH_GH_TOKEN_TOOL_NAME:
      await handleRefreshGitHubToken(outputItem, ctx, state);
      break;

    case FINAL_RESPONSE_TOOL_NAME:
      if (ctx.runToolOptions.subtasks) await assertSubagentsFinished(ctx.taskId);
      if (
        ctx.workflowContext?.workflowType === "agent_swarm"
        && (
          ctx.runMode !== "agent_swarm_leader"
          || ctx.workflowContext.taskId !== ctx.workflowContext.workflowTaskId
        )
      ) {
        pushOutput(state, outputItem.call_id, {
          error: "Only the top Agent Swarm leader can call final_response. Complete your swarm work with send_channel_message or submit_swarm_output."
        });
        break;
      }
      if (
        ctx.workflowContext?.workflowType === "agent_swarm"
        && ctx.runMode === "agent_swarm_leader"
        && (ctx.workflowContext.swarm?.pendingNestedSwarmNodeIds?.length ?? 0) > 0
        && !isForcedFinalResponse(outputItem)
      ) {
        pushOutput(state, outputItem.call_id, {
          error: `Started nested swarms have not published their output: ${ctx.workflowContext.swarm!.pendingNestedSwarmNodeIds!.join(", ")}.`
        });
        break;
      }
      if (
        ctx.workflowContext?.workflowType === "long_horizon"
        && (
          ctx.runMode !== "long_horizon_main"
          || (ctx.workflowContext.longHorizon?.enableReviewPhase !== false && ctx.workflowContext.phase !== "approved")
        )
      ) {
        pushOutput(state, outputItem.call_id, {
          error: "Long Horizon review approval is required before final_response. Continue the workflow with its available action."
        });
        break;
      }
      if (
        ctx.workflowContext?.workflowType === "agent_swarm"
        && (ctx.runMode !== "agent_swarm_leader" || !hasApprovedSwarmFinalReview(ctx.workflowContext))
        && !isForcedFinalResponse(outputItem)
      ) {
        pushOutput(state, outputItem.call_id, {
          error: "The final swarm review is missing. Record it first, or call final_response again with force: true to deliver now."
        });
        break;
      }
      finalResponse = handleFinalResponse(outputItem, state);
      break;

    case MARK_ARTIFACT_TOOL_NAME:
      await handleMarkArtifact(outputItem, ctx, state);
      break;

    case CREATE_INTERACTIVE_CANVAS_TOOL_NAME:
      await handleCreateInteractiveCanvas(outputItem, ctx, state);
      break;

    case INIT_SANDBOX_TOOL_NAME: {
      const result = await ctx.initializeSandbox?.();
      pushOutput(state, outputItem.call_id, {
        ok: true,
        alreadyInitialized: result?.alreadyInitialized === true,
        message: result?.alreadyInitialized === true
          ? "Sandbox was already initialized. Full tools are available."
          : "Sandbox initialized. Full tools are available on the next turn."
      });
      break;
    }

    case WAIT_TOOL_NAME:
      waitRequest = await handleWaitTool(outputItem, ctx, state);
      break;

    case SWARM_PAUSE_TOOL_NAME:
      workflowPause = await handleSwarmPauseTool(outputItem, ctx, state);
      break;

    case SWARM_MANAGE_TOOL_NAME:
      await handleSwarmManage(outputItem, ctx, state);
      break;

    case SWARM_BUDGET_STATUS_TOOL_NAME:
      await handleSwarmBudgetStatus(outputItem, ctx, state);
      break;

    case SWARM_SPAWN_NODE_TOOL_NAME:
      await handleSwarmSpawnNode(outputItem, ctx, state);
      break;

    case SWARM_GRANT_BUDGET_TOOL_NAME:
      await handleSwarmGrantBudget(outputItem, ctx, state);
      break;

    case SWARM_CANCEL_NODE_TOOL_NAME:
      await handleSwarmCancelNode(outputItem, ctx, state);
      break;

    case SWARM_RECORD_REVIEW_TOOL_NAME:
      await handleSwarmRecordReview(outputItem, ctx, state);
      break;

    case SWARM_RECORD_FINAL_REVIEW_TOOL_NAME:
      await handleSwarmRecordFinalReview(outputItem, ctx, state);
      break;

    case STOP_TASK_TOOL_NAME:
      stopRequest = await handleStopTask(outputItem, ctx, state);
      break;

    case VIEW_IMAGE_TOOL_NAME:
      await handleViewImage(outputItem, ctx, state);
      break;

    case VIEW_PDF_FILE_TOOL_NAME:
      if (ctx.compatibilityModes?.includes("disablePdfFile")) {
        throw new Error("view_pdf_file is disabled for this model.");
      }
      await handleViewPdf(outputItem, ctx, state);
      break;

    case QUERY_TASKS_TOOL_NAME:
    case LEGACY_SEARCH_TASK_HISTORY_TOOL_NAME:
      await handleQueryTasks(outputItem, ctx, state);
      break;

    case VIEW_TASK_HISTORY_TOOL_NAME:
      await handleViewTaskHistory(outputItem, ctx, state);
      break;

    case MEMORY_SEARCH_TOOL_NAME:
      await handleMemorySearch(outputItem, ctx, state);
      break;

    case SEARCH_WEB_TOOL_NAME:
      await handleSearchWeb(outputItem, ctx, state);
      break;

    case LIST_LIVE_SYNC_FILES_TOOL_NAME:
      await handleListLiveSyncFiles(outputItem, ctx, state);
      break;

    case GET_LIVE_SYNC_STATUS_TOOL_NAME:
      await handleGetLiveSyncStatus(outputItem, ctx, state);
      break;

    case PULL_LIVE_SYNC_FILE_TOOL_NAME:
      await handlePullLiveSyncFile(outputItem, ctx, state);
      break;

    case PUSH_LIVE_SYNC_FILE_TOOL_NAME:
      await handlePushLiveSyncFile(outputItem, ctx, state);
      break;

    case LIST_SKILLS_TOOL_NAME:
      await handleListSkills(outputItem, ctx, state);
      break;

    case ENABLE_SKILL_TOOL_NAME:
      await handleEnableSkill(outputItem, ctx, state);
      break;

    case SCHEDULE_TASK_TOOL_NAME:
      await handleScheduleTask(outputItem, ctx, state);
      break;

    case EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME:
      await handleEditCurrentTaskSchedule(outputItem, ctx, state);
      break;

    case CREATE_SUBTASK_TOOL_NAME:
      await handleCreateSubtask(outputItem, ctx, state);
      break;

    case START_SUBTASK_TOOL_NAME:
      await handleStartSubtask(outputItem, ctx, state);
      break;

    case START_LONG_HORIZON_TASK_TOOL_NAME: {
      const action = await handleStartLongHorizonTask(outputItem, ctx, state);
      workflowPause = action ? { kind: action } : null;
      break;
    }

    case REQUEST_CLARIFICATION_TOOL_NAME: {
      const response = handleRequestClarification(outputItem, ctx, state);
      workflowPause = response
        ? { kind: "long_horizon_clarification_requested", response }
        : null;
      break;
    }

    case SUBMIT_RESPONSE_TOOL_NAME: {
      const action = await handleSubmitResponse(outputItem, ctx, state);
      workflowPause = action ? { kind: action } : null;
      break;
    }

    case SUBMIT_REVIEW_TOOL_NAME: {
      const action = await handleSubmitReview(outputItem, ctx, state);
      workflowPause = action ? { kind: action } : null;
      break;
    }

    case REFRESH_INBOX_TOOL_NAME:
      await handleRefreshInbox(outputItem, ctx, state);
      break;

    case LIST_CHANNELS_TOOL_NAME:
      await handleListChannels(outputItem, ctx, state);
      break;

    case READ_CHANNEL_TOOL_NAME:
      await handleReadChannel(outputItem, ctx, state);
      break;

    case CREATE_CHANNEL_TOOL_NAME:
      await handleCreateChannel(outputItem, ctx, state);
      break;

    case SEND_CHANNEL_MESSAGE_TOOL_NAME: {
      workflowPause = await handleSendChannelMessage(outputItem, ctx, state);
      break;
    }

    case SUBMIT_SWARM_OUTPUT_TOOL_NAME:
      await handleSubmitSwarmOutput(outputItem, ctx, state);
      break;

    default: {
      const handledComputerTool = await handleComputerToolCall(outputItem, ctx, state);
      if (handledComputerTool) {
        break;
      }
      const handled = await handleSkillToolCall(outputItem, ctx, state);
      if (!handled) {
        pushOutput(state, outputItem.call_id, { error: `Unknown tool: ${outputItem.name}` });
      }
      break;
    }
  }

  return { finalResponse, waitRequest, stopRequest, workflowPause };
}

async function dispatchCustomToolCall(
  outputItem: ApplyPatchCustomToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  switch (outputItem.name) {
    case APPLY_PATCH_TOOL_NAME:
      await handleApplyPatch(outputItem, ctx, state);
      break;

    default:
      throw new Error(`Unknown custom tool: ${outputItem.name}`);
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
      try {
        await handleContextManagementV2Tool(outputItem, ctx, state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = pushOutput(state, outputItem.call_id, { error: message });
        await recordContextItems(ctx.contextManagementV2, [failure]);
        console.info("[context-management-v2]", JSON.stringify({
          version: "v2",
          failureClass: error instanceof Error ? error.name : "unknown"
        }));
      }
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
      const outputStart = state.conversationItems.length;
      try {
        await handleApplyPatch(outputItem, ctx, state);
      } catch (error) {
        await finishUnhandledToolFailure(outputItem, ctx, state, error);
      }
      if (ctx.contextManagementV2 && state.conversationItems.length > outputStart) {
        await recordContextItems(ctx.contextManagementV2, state.conversationItems.slice(outputStart));
      }
      continue;
    }

    if (isApplyPatchCustomToolCallItem(outputItem)) {
      sawToolCall = true;
      sawFunctionToolCall = true;
      invalidatePendingSwarmSendAfterRefresh(ctx);
      const outputStart = state.conversationItems.length;
      await ctx.assertNotCancelled();

      try {
        await dispatchCustomToolCall(outputItem, ctx, state);
      } catch (error) {
        await finishUnhandledToolFailure(outputItem, ctx, state, error);
      }

      if (ctx.contextManagementV2 && state.conversationItems.length > outputStart) {
        await recordContextItems(ctx.contextManagementV2, state.conversationItems.slice(outputStart));
      }

      await ctx.assertNotCancelled();
      continue;
    }

    if (isCustomToolCallItem(outputItem)) {
      sawToolCall = true;
      sawFunctionToolCall = true;
      invalidatePendingSwarmSendAfterRefresh(ctx);
      if (!hasCustomToolOutput(state, outputItem.call_id)) {
        const outputStart = state.conversationItems.length;
        pushCustomToolOutput(
          state,
          outputItem.call_id,
          `Error: Unsupported custom tool: ${outputItem.name}`
        );
        if (ctx.contextManagementV2) {
          await recordContextItems(ctx.contextManagementV2, state.conversationItems.slice(outputStart));
        }
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
      const conversationLength = state.conversationItems.length;
      const result = await dispatchFunctionToolCall(outputItem, ctx, state);
      if (ctx.contextManagementV2 && state.conversationItems.length > conversationLength) {
        await recordContextItems(ctx.contextManagementV2, state.conversationItems.slice(conversationLength));
      }
      if (repeatedCallReminder) {
        const reminder = { role: "developer" as const, content: repeatedCallReminder };
        state.conversationItems.push(reminder);
        state.runPersistedItems.push(reminder);
        if (ctx.contextManagementV2) {
          await recordContextItems(ctx.contextManagementV2, [reminder]);
        }
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
    } catch (error) {
      await finishUnhandledToolFailure(outputItem, ctx, state, error);
    } finally {
      if (outputItem.name === SEND_CHANNEL_MESSAGE_TOOL_NAME) {
        invalidatePendingSwarmSendAfterRefresh(ctx);
      }
    }

    await ctx.assertNotCancelled();
  }

  return { sawToolCall, sawFunctionToolCall, finalResponse, waitRequest, stopRequest, workflowPause };
}
