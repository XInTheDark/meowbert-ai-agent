import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { z } from "zod";
import { conversationMapSchema, MESSAGE_LINK_PATTERN, validateConversationMap, turnSummarySchema } from "@meowbert/shared";
import type { ToolDispatchState } from "../types.js";
import type { ToolCallResult } from "../tool-call-result.js";

export function handleConversationOrganization(call: ResponseFunctionToolCall, state: ToolDispatchState): ToolCallResult {
  const organization = state.organization;
  if (!organization) throw new Error("New message organization is disabled for this run.");
  const input: unknown = JSON.parse(call.arguments);
  if (call.name === "update_conversation_outline") {
    const { markdown } = z.object({ markdown: z.string().trim().min(1).max(100000) }).strict().parse(input);
    const allowed = new Set([...organization.publicMessageIds, "current"]);
    for (const match of markdown.matchAll(MESSAGE_LINK_PATTERN)) {
      if (!allowed.has(match[1])) throw new Error(`Message ${match[1]} is not in this conversation.`);
    }
    organization.outline = markdown;
    organization.outlineChanged = markdown !== organization.navigation.outline?.markdown;
  } else {
    const update = conversationMapSchema.parse(input);
    const nodes = new Map(organization.graph?.nodes.map((node) => [node.id, node]));
    const topics = new Map(organization.graph?.topics.map((topic) => [topic.id, topic]));
    update.nodes.forEach((node) => nodes.set(node.id, node));
    update.topics.forEach((topic) => topics.set(topic.id, topic));
    const graph = conversationMapSchema.parse({ nodes: [...nodes.values()], topics: [...topics.values()],
      main_path_end_id: update.main_path_end_id ?? organization.graph?.main_path_end_id ?? null });
    validateConversationMap(graph, [...organization.navigation.turns.filter((turn) => turn.completed).map((turn) => turn.id), "current"]);
    organization.graph = graph;
    organization.mapChanged = true;
  }
  return { output: { staged: true } };
}

export function validateOrganizationFinalResponse(input: {
  partial?: boolean | null; summary?: string | null; outline_review?: string | null;
}, state: ToolDispatchState): void {
  const organization = state.organization;
  if (!organization || input.partial) return;
  turnSummarySchema.parse(input.summary);
  const expected = organization.outline === null ? "not_applicable" : organization.outlineChanged ? "updated" : "unchanged";
  if (input.outline_review !== expected) throw new Error(`Review the conversation outline, then set outline_review to ${expected}.`);
  if (organization.graph && !organization.graph.main_path_end_id) throw new Error("Choose the conversation map main-path endpoint before final_response.");
  if (organization.graph && !organization.graph.nodes.some((node) => node.id === "current")) {
    throw new Error("Place current in the conversation map before final_response.");
  }
}
