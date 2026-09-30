import { getNewMessageOrganizationEnabled, loadConversationNavigation,
  type ConversationMap, type ConversationNavigation } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import type { PreparedAgentRunContext } from "./runtime.js";
import type { TaskExecutionJob } from "@meowbert/shared";

export interface ConversationOrganizationState {
  navigation: ConversationNavigation;
  publicMessageIds: string[];
  outline: string | null;
  graph: ConversationMap | null;
  outlineChanged: boolean;
  mapChanged: boolean;
}

export async function prepareConversationOrganization(prepared: PreparedAgentRunContext, job: TaskExecutionJob): Promise<ConversationOrganizationState | undefined> {
  if (!getNewMessageOrganizationEnabled(prepared.snapshot.workspace_model_defaults)
    || (prepared.isSubtask && !prepared.snapshot.task.is_thread) || prepared.isQualityReviewSpecialist
    || (prepared.snapshot.task.workflow_internal_role && prepared.snapshot.task.workflow_internal_role !== "leader")
    || job.mode === "memory_synthesis") return undefined;
  const leaf = prepared.snapshot.branch_leaf_message_id;
  const navigation = await loadConversationNavigation({ query }, job.taskId, leaf);
  return { navigation, publicMessageIds: navigation.messages.map((message) => message.id), outline: navigation.outline?.markdown ?? null,
    graph: navigation.map?.graph ?? null, outlineChanged: false, mapChanged: false };
}

export function conversationOrganizationPrompt(state: ConversationOrganizationState): string {
  return `These conversation organization tools and final_response are available without initializing the sandbox.
Organize the conversation for the reader when an extended lesson, interactive task or several topics would benefit from it. Use update_conversation_outline for a Markdown document with importance-ordered Key points and a selective chronological Log. This is public, separate from private notes. Link to messages with [label](#message-ID); use #message-current for this reply.
Use update_conversation_map to arrange turn IDs under earlier turns, assign topics and choose the main-path endpoint. Use "current" for this reply. A map is navigation only. You can organize older turns and correct previous relationships; read view_task_history for IDs and public history. Its navigation view returns the outline and map. Do not create entries just to fill space.
Every concluding final_response needs a concise, plain-text, single-line summary of the exchange (at most 160 characters). Once an outline exists, review it every turn: update it or set outline_review to "unchanged". Use "updated" after editing and "not_applicable" if there is no outline. Once a map exists, place the current turn before finishing. Partial response segments are exempt.
Organization now: ${JSON.stringify({ outline_exists: state.outline !== null, map_exists: state.graph !== null })}`;
}
