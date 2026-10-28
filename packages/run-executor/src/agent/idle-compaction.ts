import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { TaskExecutionJob } from "@meowbert/shared";
import { recordContextItems } from "../context-management-v2/window.js";
import { resetV2ContextWindow } from "./context-window.js";
import type { AgentExecutionContext } from "./execution-types.js";

// Enough to read and rewrite a few notes; the turn is only bookkeeping.
const IDLE_COMPACTION_MAX_STEPS = 8;

const IDLE_COMPACTION_NOTE = [
  "This conversation has gone idle, so its context window will be cleared after this turn.",
  "Update your notes now with what you need to pick up where you left off.",
  "Only the notes and history tools work here, and nothing you write reaches the user."
].join(" ");

export function isIdleCompactionRun(job: Pick<TaskExecutionJob, "mode" | "contextAction">): boolean {
  return job.mode === "compact_only" && job.contextAction === "idle";
}

// The request is the next turn the conversation would send, with the note added at the end, so it
// reads the prompt cache the last turn wrote. The window is cleared once the model stops writing notes.
export async function runIdleCompaction(
  execution: AgentExecutionContext,
  runStepLoop: (execution: AgentExecutionContext) => Promise<void>
): Promise<void> {
  const { dispatchState } = execution.state;
  const note: ResponseInputItem = { role: "developer", content: IDLE_COMPACTION_NOTE };
  dispatchState.conversationItems.push(note);
  dispatchState.runPersistedItems.push(note);
  if (execution.state.contextManagement.version === "v2") {
    await recordContextItems(execution.prepared.control.context, execution.state.contextManagement, [note]);
  }

  execution.maxRunSteps = Math.min(execution.maxRunSteps, IDLE_COMPACTION_MAX_STEPS);
  await runStepLoop(execution);
  await resetV2ContextWindow(execution, "idle");
}
