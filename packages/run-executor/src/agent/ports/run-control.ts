import type { ConversationNavigation, ConversationSnapshot, TaskEventType, TaskStatus } from "@meowbert/shared";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { RunBootstrap } from "./run-bootstrap.js";
import type { PlatformToolHost } from "./platform-tools.js";
import type { WindowRequestState } from "../window-request-types.js";

// Everything a run does with the control plane's database and pub/sub. Cloud workers use an
// in-process implementation; executors elsewhere reach the same operations through the Run API.
// Every argument and result is plain JSON so each call can cross a process boundary.
export interface RunControl {
  bootstrap(): Promise<RunBootstrap>;
  setTaskStatus(status: TaskStatus): Promise<boolean>;
  readCancellation(): Promise<RunCancellationState>;
  watchCancellation(notify: (reason: RunCancellationReason) => void): () => void;
  consumeCommandInterrupt(step: number): Promise<boolean>;
  appendMessage(input: AppendRunMessageInput): Promise<string>;
  // Moves the run's selecting user to this message; a no-op for runs without one.
  selectBranch(messageId: string): Promise<void>;
  emitEvent(type: TaskEventType, payload: Record<string, unknown>): Promise<void>;
  isDebugEnabled(): Promise<boolean>;
  loadConversationNavigation(leafMessageId: string | null): Promise<ConversationNavigation>;
  setGeneratedTitle(title: string): Promise<void>;
  recordToolCallStart(input: RunToolCallStart): Promise<void>;
  recordToolCallResult(input: RunToolCallResult): Promise<void>;
  // Clears calls an earlier run left unfinished once the agent has been told about them.
  resolveInterruptedToolCalls(callIds: string[]): Promise<void>;
  readonly context: RunContextStore;
  readonly platform: PlatformToolHost;
  complete(input: RunCompletion): Promise<RunCompletionResult>;
  fail(input: RunFailure): Promise<void>;
}

export type RunMessageRole = "user" | "assistant" | "system" | "tool";

export interface AppendRunMessageInput {
  role: RunMessageRole;
  content: Record<string, unknown>;
  parentMessageId: string | null;
  agentId?: string | null;
  reasoningContentCount?: number | null;
  organizationSnapshots?: Array<Pick<ConversationSnapshot, "kind" | "payload_json">>;
}

export type RunCancellationReason = "explicit_cancel" | "newer_attempt";

export interface RunCancellationState {
  cancelRequested: boolean;
  latestAttempt: boolean;
}

export interface RunToolCallStart {
  callId: string;
  name: string;
  arguments: string;
}

export interface RunToolCallResult {
  callId: string;
  output: string;
}

// How a run ends when the agent loop finishes normally.
export type RunCompletion =
  | {
      // The task finished its turn: completion, delivery and recurring-schedule bookkeeping.
      kind: "succeeded";
      finalResponse: string;
      notificationRequested: boolean;
      pauseTimedSchedule: boolean;
    }
  | {
      // The run ended and leaves the task in this status (paused workflows, compaction runs).
      kind: "status";
      status: TaskStatus;
      // Left unset to keep what the run already recorded.
      notificationRequested?: boolean;
    }
  | {
      // Another path already moved the task on; only the run itself ends.
      kind: "ended";
    };

export interface RunCompletionResult {
  updatedStatus: boolean;
}

export interface RunFailure {
  errorMessage: string;
  // Model output produced before the failure, kept on the branch.
  persistedItems: ResponseInputItem[];
  currentLeafMessageId: string | null;
  agentId: string | null;
  reasoningContentCount: number;
}

export interface ContextWindowRef {
  taskId: string;
  windowId: string;
  contextNodeId: string;
}

export interface OpenedContextWindow {
  firstWindowId: string;
  windowId: string;
  contextNodeId: string;
  previousWindowId: string | null;
}

export interface ContextHistoryRecord {
  id: string;
  item: ResponseInputItem;
  callNumber?: number;
}

export interface ContextNotesSummary {
  continuity: string | null;
  index: Array<{ path: string; size: number; updatedAt: string }>;
}

export interface ContextHistoryFilter {
  limit?: number | null;
  recent_first?: boolean | null;
  role?: string | null;
  tool_namespace?: string | null;
  tool_name?: string | null;
  window_id?: string | null;
}

// Persistence for v2 context windows, their history items and private notes.
export interface RunContextStore {
  freezeVersion(requestedVersion: "v1" | "v2", runtimeModel: string): Promise<"v1" | "v2">;
  openWindow(branchLeafMessageId: string | null): Promise<OpenedContextWindow>;
  loadWindowItems(windowId: string): Promise<ResponseInputItem[]>;
  recordItems(window: ContextWindowRef, records: ContextHistoryRecord[]): Promise<void>;
  // The highest call number recorded for the task, or 0.
  loadLastCallNumber(): Promise<number>;
  loadNotesSummary(contextNodeId: string): Promise<ContextNotesSummary>;
  // Preserve the first window-opening prompt across runs, even after private notes change.
  freezeWindowPrompt(window: ContextWindowRef, items: ResponseInputItem[]): Promise<ResponseInputItem[]>;
  // Freeze setup once; ordinary requests update the last tool recipe, idle requests only read it.
  prepareWindowRequest(window: ContextWindowRef, request: WindowRequestState, idle: boolean): Promise<WindowRequestState>;
  startNewWindow(window: ContextWindowRef, branchLeafMessageId: string | null, reason: string): Promise<{ windowId: string; contextNodeId: string }>;
  linkVisibleMessage(window: ContextWindowRef, visibleMessageId: string): Promise<string>;
  writeNote(window: ContextWindowRef, input: { path: string; text: string; append: boolean }): Promise<{ path: string; bytes: number }>;
  listWindows(window: ContextWindowRef, input: { limit?: number | null; recent_first?: boolean | null }): Promise<{ windows: Array<{ window_id: string; item_count: number }> }>;
  listItems(window: ContextWindowRef, input: ContextHistoryFilter & {
    max_chars_per_item?: number | null;
    from_call_number?: number | null;
    to_call_number?: number | null;
  }): Promise<{ items: ContextHistoryItemSummary[] }>;
  readItem(window: ContextWindowRef, input: {
    window_id?: string | null;
    item_id?: string | null;
    call_number?: number | null;
    offset_chars?: number | null;
    limit_chars?: number | null;
  }): Promise<Record<string, unknown>>;
  searchHistory(window: ContextWindowRef, input: ContextHistoryFilter & { query: string }): Promise<{ items: ContextHistoryItemSummary[] }>;
  listNotes(window: ContextWindowRef, input: {
    prefix?: string | null;
    max_results?: number | null;
    file_order_by?: "name" | "created_at" | "updated_at" | null;
    file_order?: "ascending" | "descending" | null;
  }): Promise<{ files: Array<{ path: string; bytes: number; created_at: string; updated_at: string }> }>;
  readNote(window: ContextWindowRef, input: { path: string; start_line?: number | null; stop_line?: number | null }): Promise<Record<string, unknown>>;
}

export interface ContextHistoryItemSummary {
  item_id: string;
  call_number?: number;
  role: string;
  tool_namespace: string | null;
  tool_name: string | null;
  truncated_content: string;
}
