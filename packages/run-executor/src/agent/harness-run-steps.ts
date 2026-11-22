import { getResponseTotalTokens } from "../context-management-v2/token-usage.js";
import type { AgentExecutionContext } from "./execution-types.js";
import { buildHarnessRunNotice, recordHarnessTokens } from "./harness-run-state.js";
import { appendRuntimeNotice } from "./runtime-notices.js";
import type { ResponseUsage } from "openai/resources/responses/responses";

const BUDGET_SPENT_NOTICE = "[System: This task's token budget is used up. Call final_response now with your answer; keep-alive ends here.]";
const budgetNoticeSent = new WeakSet<AgentExecutionContext>();

function isKeepAliveCycleRun(execution: AgentExecutionContext): boolean {
  return execution.job.mode === "infinite_auto" && execution.runTiming.isTimedInfiniteRun;
}

// Opens the run with the task's harness settings, and tells the agent to wrap up once its budget is spent.
export function appendHarnessStepNotices(execution: AgentExecutionContext, step: number): void {
  if (execution.swarm?.lane) return;
  if (step === 0) {
    const notice = buildHarnessRunNotice({
      state: execution.harness,
      scheduleInfo: execution.scheduleInfo,
      isKeepAliveCycle: isKeepAliveCycleRun(execution),
      spentTokens: execution.harness.spentTokensAtStart
    });
    if (notice) appendRuntimeNotice(execution, { role: "user", content: notice });
  }
  const budget = execution.harness.settings.tokenBudget?.value;
  if (budget !== undefined && execution.harness.spentTokensAtStart >= budget) execution.harness.budgetExhausted = true;
  if (execution.harness.budgetExhausted && !budgetNoticeSent.has(execution)) {
    budgetNoticeSent.add(execution);
    appendRuntimeNotice(execution, { role: "user", content: BUDGET_SPENT_NOTICE });
  }
}

// Adds this run's unsaved tokens to the task's total. Best effort: the run's own result stands.
export async function saveHarnessTokens(execution: AgentExecutionContext): Promise<void> {
  const tokens = execution.harness.unsavedTokens;
  if (execution.swarm?.lane || tokens <= 0) return;
  try {
    await execution.prepared.control.platform.addTaskSpentTokens(tokens);
    execution.harness.unsavedTokens -= tokens;
  } catch {
    // Retried with the next save.
  }
}

// Counts a model turn against the task's token budget, using the swarm's weighted cost when known.
// With a budget set, the total is saved every turn so a failed or cancelled run still counts;
// otherwise once when the run finishes.
export async function recordHarnessTurnTokens(execution: AgentExecutionContext, turn: { weightedTokens: number | null; usage: ResponseUsage | undefined }): Promise<void> {
  const tokens = turn.weightedTokens ?? getResponseTotalTokens(turn.usage) ?? 0;
  recordHarnessTokens(execution.harness, tokens);
  if (execution.harness.settings.tokenBudget) await saveHarnessTokens(execution);
}
