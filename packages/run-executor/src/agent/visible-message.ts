import { linkContextNodeToVisibleMessage } from "../context-management-v2/window.js";
import type { AgentExecutionContext } from "./execution-types.js";

// Makes the message just appended the one the task's context and branch point at.
export async function adoptVisibleMessage(execution: AgentExecutionContext): Promise<void> {
  const messageId = execution.state.currentLeafMessageId;
  if (!messageId) return;
  const { control } = execution.prepared;
  if (execution.state.contextManagement?.version === "v2") {
    execution.state.contextManagement = await linkContextNodeToVisibleMessage(control.context, {
      state: execution.state.contextManagement,
      visibleMessageId: messageId
    });
  }
  await control.selectBranch(messageId);
}
