import type { ResponseInputItem } from "openai/resources/responses/responses";
import { parseRetryDeadlineMs, type TaskExecutionJob } from "@meowbert/shared";
import { selectRolloverSeedItems } from "../context-management-v2/rollover-seed.js";
import { recordContextItems } from "../context-management-v2/window.js";
import { resetV2ContextWindow } from "./context-window.js";
import type { AgentExecutionContext } from "./execution-types.js";

// Enough to read and rewrite a few notes; the turn is only bookkeeping.
const IDLE_COMPACTION_MAX_STEPS = 8;

const IDLE_COMPACTION_NOTE = "[System: " + [
  "This conversation has gone idle, so its context window will be cleared after this turn.",
  "Your recent messages with the user will stay. Update the note continuity.md now with anything else you need to pick up where you left off.",
  "Only the notes tools work here, and nothing you write reaches the user."
].join(" ") + "]";

export function isIdleCompactionRun(job: Pick<TaskExecutionJob, "mode" | "contextAction">): boolean {
  return job.mode === "compact_only" && job.contextAction === "idle";
}

// A run can sit in the queue past its deadline, so it checks before spending a request.
export function assertIdleCompactionNotExpired(job: Pick<TaskExecutionJob, "idleCompactionDeadlineAt">): void {
  const deadlineAtMs = parseRetryDeadlineMs(job.idleCompactionDeadlineAt);
  if (deadlineAtMs !== null && Date.now() >= deadlineAtMs) {
    throw new Error("The prompt cache window ended before idle compaction could run.");
  }
}

function isCancellation(execution: AgentExecutionContext, error: unknown): boolean {
  return execution.prepared.cancellationMonitor?.signal.aborted === true
    || (error instanceof Error && error.message === "TASK_CANCELLED");
}

function removeItem(items: ResponseInputItem[], item: ResponseInputItem): void {
  const index = items.lastIndexOf(item);
  if (index >= 0) items.splice(index, 1);
}

export type IdleCompactionResult = { notesTurn: "completed" } | { notesTurn: "failed"; errorMessage: string };

// The request is the next turn the conversation would send, with the note added at the end, so it
// reads the prompt cache the last turn wrote. The window is cleared once the model stops writing notes.
// If that turn fails, the window is still cleared: the recent exchange with the user carries over
// and the agent keeps whatever notes it already had.
export async function runIdleCompaction(
  execution: AgentExecutionContext,
  runStepLoop: (execution: AgentExecutionContext) => Promise<void>
): Promise<IdleCompactionResult> {
  const { dispatchState } = execution.state;
  // Taken before the turn, whose own closing text is not part of the conversation with the user.
  const seedItems = selectRolloverSeedItems(dispatchState.conversationItems, { replies: true });
  // A user turn, not a developer one: the last turn usually ends on an assistant reply, and
  // Claude proxies lift a system item that follows an assistant reply into the system prompt and
  // drop that reply. That rewrites the cached prefix and breaks session resume on the next step.
  const note: ResponseInputItem = { role: "user", content: IDLE_COMPACTION_NOTE };
  dispatchState.conversationItems.push(note);
  dispatchState.runPersistedItems.push(note);
  // Recorded before the turn it asks for, so an interrupted run replays it ahead of that turn's notes activity.
  if (execution.state.contextManagement.version === "v2") {
    await recordContextItems(execution.prepared.control.context, execution.state.contextManagement, [note]);
  }

  execution.maxRunSteps = Math.min(execution.maxRunSteps, IDLE_COMPACTION_MAX_STEPS);
  try {
    await runStepLoop(execution);
  } catch (error) {
    if (isCancellation(execution, error)) throw error;
    // The note asked for a turn that never happened, so it stays out of what the run saves.
    removeItem(dispatchState.conversationItems, note);
    removeItem(dispatchState.runPersistedItems, note);
    await resetV2ContextWindow(execution, "idle", seedItems);
    return { notesTurn: "failed", errorMessage: error instanceof Error ? error.message : String(error) };
  }
  await resetV2ContextWindow(execution, "idle", seedItems);
  return { notesTurn: "completed" };
}
