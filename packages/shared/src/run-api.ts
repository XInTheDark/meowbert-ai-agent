// The Run API: how an executor outside the control plane reaches a run's state. Every call is
// `POST /runs/:runId/call/:method` with a lease token, except model requests, which go to
// `POST /runs/:runId/model/responses`.

export const RUN_API_PROTOCOL_VERSION = 2;

// A lease lasts this long after the last successful heartbeat; the server reclaims it only after
// a further grace, and an executor that cannot renew fences itself well before either.
export const RUN_LEASE_TTL_MS = 60_000;
export const RUN_LEASE_RECLAIM_GRACE_MS = 30_000;
export const RUN_LEASE_HEARTBEAT_INTERVAL_MS = 10_000;
export const RUN_LEASE_SELF_FENCE_AFTER_MS = 30_000;

// Calls that change nothing; retried freely.
export const RUN_API_READ_METHODS = [
  "control.bootstrap",
  "control.readCancellation",
  "control.isDebugEnabled",
  "control.loadConversationNavigation",
  "control.heartbeat",
  "context.loadWindowItems",
  "context.loadNotesSummary",
  "context.listWindows",
  "context.listItems",
  "context.readItem",
  "context.searchHistory",
  "context.listNotes",
  "context.readNote",
  "platform.queryTasks",
  "platform.viewTaskHistory",
  "platform.readOrganizedTaskHistory",
  "platform.searchMemory",
  "platform.liveSyncStatus",
  "platform.liveSyncFolderSearch",
  "platform.getDesktopComputerPresence",
  "platform.readShellSessionWaitState",
  "model.isQuotaExceeded"
] as const;

// Calls that change state. Each carries an operation id that a retry reuses, so a call whose
// response was lost is never applied twice.
export const RUN_API_WRITE_METHODS = [
  "control.setTaskStatus",
  "control.consumeCommandInterrupt",
  "control.appendMessage",
  "control.selectBranch",
  "control.emitEvent",
  "control.setGeneratedTitle",
  "control.recordToolCallStart",
  "control.recordToolCallResult",
  "control.resolveInterruptedToolCalls",
  "control.complete",
  "control.fail",
  "control.releaseForStorage",
  "context.freezeVersion",
  "context.openWindow",
  "context.recordItems",
  "context.startNewWindow",
  "context.linkVisibleMessage",
  "context.writeNote",
  "platform.createRecurringTask",
  "platform.editCurrentTaskSchedule",
  "platform.pauseRecurringSchedule",
  "platform.applyInfiniteWait",
  "platform.createSubtask",
  "platform.startSubtasks",
  "platform.liveSyncTransfer",
  "platform.createProjectCanvas",
  "platform.recordProjectCanvasEntry",
  "platform.markArtifacts",
  "platform.unmarkArtifacts",
  "platform.refreshGitHubToken",
  "platform.issueSourceAccess",
  "platform.requestDesktopComputerAction",
  "platform.persistentShell"
] as const;

export type RunApiReadMethod = (typeof RUN_API_READ_METHODS)[number];
export type RunApiWriteMethod = (typeof RUN_API_WRITE_METHODS)[number];
export type RunApiMethod = RunApiReadMethod | RunApiWriteMethod;

export function isRunApiWriteMethod(method: string): method is RunApiWriteMethod {
  return (RUN_API_WRITE_METHODS as readonly string[]).includes(method);
}

export function isRunApiMethod(method: string): method is RunApiMethod {
  return isRunApiWriteMethod(method) || (RUN_API_READ_METHODS as readonly string[]).includes(method);
}

export interface RunApiCallRequest {
  operationId: string;
  args: unknown[];
  // control.appendMessage: the leaf the executor believes it is appending to.
  expectedLeafId?: string | null;
  // control.emitEvent: the executor's per-run event sequence number.
  seq?: number;
}

export interface RunApiCallResponse {
  result: unknown;
}

export interface RunApiModelRequest {
  operationId: string;
  purpose: "turn" | "compaction" | "title" | "web_search";
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs: number;
  sessionId?: string;
  attempt?: number;
}

export interface RunApiModelResponse {
  response: unknown;
  weightedTokens: number | null;
}

export type RunApiErrorCode =
  // The lease moved to a newer epoch or expired: the executor must stop.
  | "lease_lost"
  // The branch leaf is not the one the executor appended to.
  | "leaf_moved"
  // The operation id was used before with a different request.
  | "operation_conflict"
  // An earlier attempt of this operation started and never recorded its result.
  | "outcome_unknown"
  | "invalid_request"
  | "unauthorized"
  | "rate_limited"
  | "quota_exceeded"
  | "internal";

export interface RunApiErrorBody {
  error: {
    code: RunApiErrorCode;
    message: string;
    currentLeafId?: string | null;
  };
}

export const RUN_API_ERROR_STATUS: Record<RunApiErrorCode, number> = {
  lease_lost: 409,
  leaf_moved: 409,
  operation_conflict: 409,
  outcome_unknown: 409,
  invalid_request: 400,
  unauthorized: 401,
  quota_exceeded: 402,
  rate_limited: 429,
  internal: 500
};
