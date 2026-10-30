import type { RunContextStore } from "@meowbert/run-executor/agent/ports/run-control";
import { writeContextNote } from "./notes.js";
import { freezeContextWindowPrompt } from "./window-prompt.js";
import { prepareContextWindowRequest } from "./window-request.js";
import type { ContextWindowRef } from "@meowbert/run-executor/agent/ports/run-control";
import {
  assertContextWindowOfTask,
  linkVisibleContextNode,
  loadContextNotesSummary,
  loadLastCallNumber,
  loadWindowItems,
  openContextWindow,
  recordContextHistoryRecords,
  resolveFrozenContextManagementVersion,
  startNewContextWindowRecord
} from "./service.js";
import {
  listContextItems,
  listContextNotes,
  listContextWindows,
  readContextItem,
  readContextNote,
  searchContextHistory
} from "./tools.js";

// Context windows of one task, read and written directly in the database. Window references are
// always resolved against `taskId`, so a caller cannot reach another task's history.
export function createDbContextStore(taskId: string): RunContextStore {
  const checked = new Set<string>();
  const own = async (window: ContextWindowRef): Promise<ContextWindowRef> => {
    const ref = { taskId, windowId: window.windowId, contextNodeId: window.contextNodeId };
    const key = `${ref.windowId}:${ref.contextNodeId}`;
    if (!checked.has(key)) {
      await assertContextWindowOfTask(ref);
      checked.add(key);
    }
    return ref;
  };
  return {
    freezeVersion: (requestedVersion, runtimeModel) => resolveFrozenContextManagementVersion({ taskId, requestedVersion, runtimeModel }),
    openWindow: (branchLeafMessageId) => openContextWindow(taskId, branchLeafMessageId),
    loadWindowItems: (windowId) => loadWindowItems(taskId, windowId),
    recordItems: (window, records) => own(window).then((ref) => recordContextHistoryRecords(ref, records)),
    loadLastCallNumber: () => loadLastCallNumber(taskId),
    loadNotesSummary: (contextNodeId) => loadContextNotesSummary(taskId, contextNodeId),
    freezeWindowPrompt: (window, items) => own(window).then((ref) => freezeContextWindowPrompt(ref, items)),
    prepareWindowRequest: (window, request, idle) => own(window).then((ref) => prepareContextWindowRequest(ref, request, idle)),
    startNewWindow: (window, branchLeafMessageId, reason) => own(window).then((ref) => startNewContextWindowRecord(ref, branchLeafMessageId, reason)),
    linkVisibleMessage: (window, visibleMessageId) => own(window).then((ref) => linkVisibleContextNode(ref, visibleMessageId)),
    writeNote: (window, input) => own(window).then((ref) => writeContextNote({
      state: ref, path: input.path, text: input.text, append: input.append
    })),
    listWindows: (window, input) => own(window).then((ref) => listContextWindows(ref, input)),
    listItems: (window, input) => own(window).then((ref) => listContextItems(ref, input)),
    readItem: (window, input) => own(window).then((ref) => readContextItem(ref, input)),
    searchHistory: (window, input) => own(window).then((ref) => searchContextHistory(ref, input)),
    listNotes: (window, input) => own(window).then((ref) => listContextNotes(ref, input)),
    readNote: (window, input) => own(window).then((ref) => readContextNote(ref, input))
  };
}
