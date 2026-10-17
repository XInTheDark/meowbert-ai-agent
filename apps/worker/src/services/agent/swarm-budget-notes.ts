import type { SwarmInferenceReservation } from "../task-workflows/agent-swarm-budget.js";
import type { AgentExecutionContext } from "./execution-types.js";

const LEADER_OVER_SHARE_NOTE = "[System: You have spent your leader share of this node's budget on your own work, so this step comes from the reserve kept for your final synthesis. Hand the remaining work to your workers with assign_worker; your share grows as they work.]";
const LEADER_RESERVE_NOTE = "[System: This node's shared budget is spent, so this step uses the reserve kept for wrapping up. Stop unfinished work and deliver what you have: final_response, or submit_swarm_output for a child node.]";
const LEADER_LOW_BUDGET_NOTE = "[System: This node's shared budget is nearly spent. Collect what your workers have, stop work that will not finish in time, and start your synthesis.]";
const WORKER_LOW_BUDGET_NOTE = "[System: This node's shared budget is nearly spent. Post your findings so far to your leader now, then finish only what is nearly done.]";

function budgetNote(reservation: SwarmInferenceReservation): string | null {
  if (reservation.overLeaderAllowance) return LEADER_OVER_SHARE_NOTE;
  if (reservation.recovery) return LEADER_RESERVE_NOTE;
  if (reservation.lowBudget) return reservation.role === "leader" ? LEADER_LOW_BUDGET_NOTE : WORKER_LOW_BUDGET_NOTE;
  return null;
}

// Appended at the end of the conversation once per run, after the prompt prefix is sealed.
export function appendSwarmBudgetNotes(execution: AgentExecutionContext, reservation: SwarmInferenceReservation | null): void {
  const note = reservation ? budgetNote(reservation) : null;
  const items = execution.state.dispatchState.conversationItems;
  if (!note || items.some((item) => "content" in item && item.content === note)) return;
  items.push({ role: "system", content: note });
}
