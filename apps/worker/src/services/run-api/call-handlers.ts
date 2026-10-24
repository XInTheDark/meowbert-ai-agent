import type { RunApiMethod } from "@meowbert/shared";
import type { RunControl } from "@meowbert/run-executor/agent/ports/run-control";
import type { RunApiSession } from "./sessions.js";

type Handler = (session: RunApiSession, args: unknown[]) => Promise<unknown>;

// Each Run API method applies the same call to the run's in-process RunControl, so a remote
// executor gets exactly what a cloud worker gets.
function controlCall(name: Exclude<keyof RunControl, "context" | "platform" | "watchCancellation">): Handler {
  return (session, args) => (session.control[name] as (...callArgs: unknown[]) => Promise<unknown>)(...args);
}

function contextCall(name: keyof RunControl["context"]): Handler {
  return (session, args) => (session.control.context[name] as (...callArgs: unknown[]) => Promise<unknown>)(...args);
}

function platformCall(name: keyof RunControl["platform"]): Handler {
  return (session, args) => (session.control.platform[name] as (...callArgs: unknown[]) => Promise<unknown>)(...args);
}

// control.heartbeat is handled with the lease, and model calls by the model proxy.
export const RUN_API_CALL_HANDLERS: Record<Exclude<RunApiMethod, "control.heartbeat" | "control.releaseForStorage">, Handler> = {
  "control.bootstrap": controlCall("bootstrap"),
  "control.readCancellation": controlCall("readCancellation"),
  "control.isDebugEnabled": controlCall("isDebugEnabled"),
  "control.loadConversationNavigation": controlCall("loadConversationNavigation"),
  "control.setTaskStatus": controlCall("setTaskStatus"),
  "control.consumeCommandInterrupt": controlCall("consumeCommandInterrupt"),
  "control.appendMessage": controlCall("appendMessage"),
  "control.selectBranch": controlCall("selectBranch"),
  "control.emitEvent": controlCall("emitEvent"),
  "control.setGeneratedTitle": controlCall("setGeneratedTitle"),
  "control.recordToolCallStart": controlCall("recordToolCallStart"),
  "control.recordToolCallResult": controlCall("recordToolCallResult"),
  "control.resolveInterruptedToolCalls": controlCall("resolveInterruptedToolCalls"),
  "control.complete": controlCall("complete"),
  "control.fail": controlCall("fail"),
  "context.freezeVersion": contextCall("freezeVersion"),
  "context.openWindow": contextCall("openWindow"),
  "context.loadWindowItems": contextCall("loadWindowItems"),
  "context.recordItems": contextCall("recordItems"),
  "context.loadNotesSummary": contextCall("loadNotesSummary"),
  "context.startNewWindow": contextCall("startNewWindow"),
  "context.linkVisibleMessage": contextCall("linkVisibleMessage"),
  "context.writeNote": contextCall("writeNote"),
  "context.listWindows": contextCall("listWindows"),
  "context.listItems": contextCall("listItems"),
  "context.readItem": contextCall("readItem"),
  "context.searchHistory": contextCall("searchHistory"),
  "context.listNotes": contextCall("listNotes"),
  "context.readNote": contextCall("readNote"),
  "platform.queryTasks": platformCall("queryTasks"),
  "platform.viewTaskHistory": platformCall("viewTaskHistory"),
  "platform.readOrganizedTaskHistory": platformCall("readOrganizedTaskHistory"),
  "platform.searchMemory": platformCall("searchMemory"),
  "platform.createRecurringTask": platformCall("createRecurringTask"),
  "platform.editCurrentTaskSchedule": platformCall("editCurrentTaskSchedule"),
  "platform.pauseRecurringSchedule": platformCall("pauseRecurringSchedule"),
  "platform.applyInfiniteWait": platformCall("applyInfiniteWait"),
  "platform.createSubtask": platformCall("createSubtask"),
  "platform.startSubtasks": platformCall("startSubtasks"),
  "platform.liveSyncStatus": platformCall("liveSyncStatus"),
  "platform.liveSyncTransfer": platformCall("liveSyncTransfer"),
  "platform.liveSyncFolderSearch": platformCall("liveSyncFolderSearch"),
  "platform.createProjectCanvas": platformCall("createProjectCanvas"),
  "platform.recordProjectCanvasEntry": platformCall("recordProjectCanvasEntry"),
  "platform.markArtifacts": platformCall("markArtifacts"),
  "platform.unmarkArtifacts": platformCall("unmarkArtifacts"),
  "platform.refreshGitHubToken": platformCall("refreshGitHubToken"),
  "platform.issueSourceAccess": platformCall("issueSourceAccess"),
  "platform.getDesktopComputerPresence": platformCall("getDesktopComputerPresence"),
  "platform.requestDesktopComputerAction": platformCall("requestDesktopComputerAction"),
  "platform.persistentShell": platformCall("persistentShell"),
  "platform.readShellSessionWaitState": platformCall("readShellSessionWaitState"),
  "model.isQuotaExceeded": (session) => session.models.isQuotaExceeded()
};
