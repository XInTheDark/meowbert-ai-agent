import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  contextEmptyArgumentsSchema,
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
import {
  listContextItems,
  listContextNotes,
  listContextWindows,
  mutateContextNote,
  readContextItem,
  readContextNote,
  recordContextItems,
  searchContextHistory,
  searchContextNotes
} from "../../context-management-v2/index.js";
import { pushToolOutput } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

const V2_TOOL_NAMES = new Set([
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
]);

export function isContextManagementV2Tool(name: string): boolean {
  return V2_TOOL_NAMES.has(name);
}

function parseArguments(call: ResponseFunctionToolCall): unknown {
  try {
    return JSON.parse(call.arguments) as unknown;
  } catch {
    throw new Error("Context management V2 tool arguments must be valid JSON.");
  }
}

async function pushContextOutput(ctx: ToolDispatchContext, state: ToolDispatchState, toolName: string, callId: string, output: unknown): Promise<void> {
  const context = ctx.contextManagementV2;
  if (!context) throw new Error("Context management V2 is unavailable for this run.");
  const item = pushToolOutput(state, callId, toolName, output);
  await recordContextItems(context, [item]);
}

export async function handleContextManagementV2Tool(
  call: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  const context = ctx.contextManagementV2;
  if (!context) throw new Error("Context management V2 is unavailable for this run.");
  const raw = parseArguments(call);
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
    case GET_CONTEXT_REMAINING_TOOL_NAME:
      contextEmptyArgumentsSchema.parse(raw);
      output = { tokens_left: state.contextUsage ? Math.max(0, state.contextUsage.maxContextTokens - state.contextUsage.usedTokens) : null };
      break;
    case HISTORY_LIST_WINDOWS_TOOL_NAME:
      output = await listContextWindows(context, historyListWindowsArgumentsSchema.parse(raw));
      break;
    case HISTORY_LIST_ITEMS_TOOL_NAME:
      output = await listContextItems(context, historyListItemsArgumentsSchema.parse(raw));
      break;
    case HISTORY_READ_ITEM_TOOL_NAME:
      output = await readContextItem(context, historyReadItemArgumentsSchema.parse(raw));
      break;
    case HISTORY_SEARCH_CONTENTS_TOOL_NAME:
      output = await searchContextHistory(context, historySearchContentsArgumentsSchema.parse(raw));
      break;
    case NOTES_LIST_FILES_BY_PREFIX_TOOL_NAME:
      output = await listContextNotes(context, notesListFilesArgumentsSchema.parse(raw));
      break;
    case NOTES_READ_FILE_TOOL_NAME:
      output = await readContextNote(context, notesReadFileArgumentsSchema.parse(raw));
      break;
    case NOTES_SEARCH_CONTENTS_TOOL_NAME:
      output = await searchContextNotes(context, notesSearchContentsArgumentsSchema.parse(raw));
      break;
    case NOTES_APPEND_TO_FILE_TOOL_NAME:
      output = await mutateContextNote(context, { ...notesMutationArgumentsSchema.parse(raw), append: true });
      if (context.recoveryPhase === "needs_note") context.recoveryPhase = "needs_reset";
      break;
    case NOTES_WRITE_FILE_TOOL_NAME:
      output = await mutateContextNote(context, { ...notesMutationArgumentsSchema.parse(raw), append: false });
      if (context.recoveryPhase === "needs_note") context.recoveryPhase = "needs_reset";
      break;
    default:
      throw new Error(`Unknown Context Management V2 tool: ${call.name}`);
  }
  await pushContextOutput(ctx, state, call.name, call.call_id, output);
}
