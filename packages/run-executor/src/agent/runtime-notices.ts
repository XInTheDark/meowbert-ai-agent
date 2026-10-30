import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "./execution-types.js";
import { recordContextItems } from "../context-management-v2/window.js";

const pendingNotices = new WeakMap<AgentExecutionContext, ResponseInputItem[]>();

export function appendRuntimeNotice(execution: AgentExecutionContext, item: ResponseInputItem): void {
  execution.state.dispatchState.conversationItems.push(item);
  execution.state.dispatchState.runPersistedItems.push(item);
  const pending = pendingNotices.get(execution) ?? [];
  pending.push(item);
  pendingNotices.set(execution, pending);
}

export async function persistRuntimeNotices(execution: AgentExecutionContext): Promise<void> {
  const pending = pendingNotices.get(execution) ?? [];
  if (pending.length === 0) return;
  if (execution.state.contextManagement.version === "v2") {
    await recordContextItems(execution.prepared.control.context, execution.state.contextManagement, pending);
  }
  pendingNotices.delete(execution);
}
