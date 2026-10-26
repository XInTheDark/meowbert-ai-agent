import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  contextEmptyArgumentsSchema,
  contextReplaceCallsArgumentsSchema,
  CONTEXT_REPLACE_CALLS_TOOL_NAME,
  historyListItemsArgumentsSchema,
  historyListWindowsArgumentsSchema,
  historyReadItemArgumentsSchema,
  historySearchContentsArgumentsSchema,
  notesListFilesArgumentsSchema,
  notesMutationArgumentsSchema,
  notesReadFileArgumentsSchema,
  notesSearchContentsArgumentsSchema,
  GET_CONTEXT_REMAINING_TOOL_NAME,
  HISTORY_LIST_ITEMS_TOOL_NAME,
  HISTORY_LIST_WINDOWS_TOOL_NAME,
  HISTORY_READ_ITEM_TOOL_NAME,
  HISTORY_SEARCH_CONTENTS_TOOL_NAME,
  NEW_CONTEXT_TOOL_NAME,
  NOTES_APPEND_TO_FILE_TOOL_NAME,
  NOTES_LIST_FILES_BY_PREFIX_TOOL_NAME,
  NOTES_READ_FILE_TOOL_NAME,
  NOTES_SEARCH_CONTENTS_TOOL_NAME,
  NOTES_WRITE_FILE_TOOL_NAME
} from "../../agent-tools/index.js";
import { searchContextNotes } from "../../context-management-v2/window.js";
import { validateContextEdit } from "../../context-management-v2/context-edits.js";
import { EXEC_TOOL_NAME } from "../../code-mode/exec-tool.js";
import { getContextWindowTokenStatus } from "../../context-management-v2/token-usage.js";
import type { ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

const V2_TOOL_NAMES = new Set([
  NEW_CONTEXT_TOOL_NAME,
  CONTEXT_REPLACE_CALLS_TOOL_NAME,
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
]);

export function isContextManagementV2Tool(name: string): boolean {
  return V2_TOOL_NAMES.has(name);
}

const CONTEXT_EDIT_REQUEST_TOOL_NAMES = new Set([EXEC_TOOL_NAME, CONTEXT_REPLACE_CALLS_TOOL_NAME]);

// Queues the edit for the turn boundary; see context-management-v2/context-edits.ts.
function queueContextEdit(call: ResponseFunctionToolCall, raw: unknown, ctx: ToolDispatchContext, state: ToolDispatchState): unknown {
  const args = contextReplaceCallsArgumentsSchema.parse(raw);
  const request = {
    fromCallNumber: args.from_call_number,
    toCallNumber: args.to_call_number,
    keepArguments: args.keep_arguments,
    inputSummary: args.input_summary,
    outputSummary: args.output_summary
  };
  const pending = state.pendingContextEdits ?? [];
  const error = validateContextEdit(state.conversationItems, request, {
    knownCallNumbers: state.callNumbers,
    requestingCallId: ctx.codeModeParentCallId ?? call.call_id,
    allowedRequestToolNames: CONTEXT_EDIT_REQUEST_TOOL_NAMES,
    pending
  });
  if (error) throw new Error(error);
  state.pendingContextEdits = [...pending, request];
  return { queued: true, note: "The calls are replaced once this turn ends." };
}

function parseArguments(call: ResponseFunctionToolCall): unknown {
  try {
    return JSON.parse(call.arguments) as unknown;
  } catch {
    throw new Error("Context management V2 tool arguments must be valid JSON.");
  }
}

export async function handleContextManagementV2Tool(
  call: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const context = ctx.contextManagementV2;
  if (!context) throw new Error("Context management V2 is unavailable for this run.");
  const raw = parseArguments(call);
  const store = ctx.control.context;
  let output: unknown;
  switch (call.name) {
    case NEW_CONTEXT_TOOL_NAME:
      contextEmptyArgumentsSchema.parse(raw);
      if (context.recoveryPhase === "needs_note") {
        throw new Error("Write or append one continuity note before starting the new context window.");
      }
      state.pendingContextV2Reset = true;
      context.pendingReset = true;
      output = "A new context window will start without summarizing conversation history.";
      break;
    case CONTEXT_REPLACE_CALLS_TOOL_NAME:
      output = queueContextEdit(call, raw, ctx, state);
      break;
    case GET_CONTEXT_REMAINING_TOOL_NAME:
      contextEmptyArgumentsSchema.parse(raw);
      output = { tokens_left: state.contextWindowUsage
        ? getContextWindowTokenStatus(state.contextWindowUsage, state.conversationItems).tokensRemaining
        : null };
      break;
    case HISTORY_LIST_WINDOWS_TOOL_NAME:
      output = await store.listWindows(context, historyListWindowsArgumentsSchema.parse(raw));
      break;
    case HISTORY_LIST_ITEMS_TOOL_NAME:
      output = await store.listItems(context, historyListItemsArgumentsSchema.parse(raw));
      break;
    case HISTORY_READ_ITEM_TOOL_NAME:
      output = await store.readItem(context, historyReadItemArgumentsSchema.parse(raw));
      break;
    case HISTORY_SEARCH_CONTENTS_TOOL_NAME:
      output = await store.searchHistory(context, historySearchContentsArgumentsSchema.parse(raw));
      break;
    case NOTES_LIST_FILES_BY_PREFIX_TOOL_NAME:
      output = await store.listNotes(context, notesListFilesArgumentsSchema.parse(raw));
      break;
    case NOTES_READ_FILE_TOOL_NAME:
      output = await store.readNote(context, notesReadFileArgumentsSchema.parse(raw));
      break;
    case NOTES_SEARCH_CONTENTS_TOOL_NAME:
      output = await searchContextNotes(store, context, notesSearchContentsArgumentsSchema.parse(raw));
      break;
    case NOTES_APPEND_TO_FILE_TOOL_NAME:
      output = await store.writeNote(context, { ...notesMutationArgumentsSchema.parse(raw), append: true });
      if (context.recoveryPhase === "needs_note") context.recoveryPhase = "needs_reset";
      break;
    case NOTES_WRITE_FILE_TOOL_NAME:
      output = await store.writeNote(context, { ...notesMutationArgumentsSchema.parse(raw), append: false });
      if (context.recoveryPhase === "needs_note") context.recoveryPhase = "needs_reset";
      break;
    default:
      throw new Error(`Unknown Context Management V2 tool: ${call.name}`);
  }
  return { output };
}
