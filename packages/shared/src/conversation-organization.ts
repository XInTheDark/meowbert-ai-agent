import { z } from "zod";

export const conversationReferenceSchema = z.union([z.string().uuid(), z.literal("current")]);
export const conversationMapNodeSchema = z.object({
  id: conversationReferenceSchema,
  parent_id: conversationReferenceSchema.nullable(),
  topic_id: z.string().min(1).max(80).nullable()
}).strict();
export const conversationTopicSchema = z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(100) }).strict();
export const conversationMapSchema = z.object({
  nodes: z.array(conversationMapNodeSchema).max(10000),
  topics: z.array(conversationTopicSchema).max(200),
  main_path_end_id: conversationReferenceSchema.nullable()
}).strict();
export type ConversationMap = z.infer<typeof conversationMapSchema>;
export type ConversationMapNode = z.infer<typeof conversationMapNodeSchema>;

export interface ConversationTurn {
  id: string;
  message_ids: string[];
  user_message_id: string | null;
  summary: string;
  has_summary: boolean;
  completed: boolean;
  index: number;
}

export interface ConversationNavigation {
  enabled: boolean;
  active_leaf_message_id: string | null;
  outline: { markdown: string; message_id: string } | null;
  map: { graph: ConversationMap; message_id: string } | null;
  turns: ConversationTurn[];
  messages: ConversationPublicMessage[];
}

export interface ConversationPublicMessage {
  id: string;
  role: string;
  text: string;
  summary: string | null;
  created_at: string;
  parent_message_id: string | null;
}

export const turnSummarySchema = z.string().trim().min(1).max(160).refine((value) => !/[\r\n]/.test(value), "Summary must be one line.");

export function conversationPreview(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " code ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
}

export function buildConversationTurns(messages: ConversationPublicMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let pending: ConversationPublicMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      pending.push(message);
    } else if (message.role === "assistant" && (message.text.trim() || message.summary)) {
      turns.push({ id: message.id, message_ids: [...pending.map((item) => item.id), message.id],
        user_message_id: pending[0]?.id ?? null, summary: message.summary ?? conversationPreview(pending[0]?.text || message.text),
        has_summary: Boolean(message.summary), completed: true, index: turns.length + 1 });
      pending = [];
    }
  }
  if (pending.length) turns.push({ id: pending[0].id, message_ids: pending.map((item) => item.id),
    user_message_id: pending[0].id, summary: conversationPreview(pending[0].text), has_summary: false,
    completed: false, index: turns.length + 1 });
  return turns;
}

export function validateConversationMap(graph: ConversationMap, orderedTurnIds: string[]): void {
  const order = new Map(orderedTurnIds.map((id, index) => [id, index]));
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const topics = new Set(graph.topics.map((topic) => topic.id));
  if (graph.nodes.length && graph.nodes.filter((node) => node.parent_id === null).length !== 1) throw new Error("The map must have one root turn.");
  if (nodes.size !== graph.nodes.length || topics.size !== graph.topics.length) throw new Error("Duplicate turn or topic ID.");
  for (const node of graph.nodes) {
    const position = order.get(node.id);
    if (position === undefined) throw new Error(`Turn ${node.id} is not in this conversation.`);
    if (node.parent_id !== null && (!nodes.has(node.parent_id) || (order.get(node.parent_id) ?? Infinity) >= position)) {
      throw new Error("A parent must be an earlier mapped turn in this conversation.");
    }
    if (node.topic_id !== null && !topics.has(node.topic_id)) throw new Error("Unknown topic ID.");
  }
  if (graph.main_path_end_id && !nodes.has(graph.main_path_end_id)) throw new Error("Main path must end at a mapped turn.");
}

export const MESSAGE_LINK_PATTERN = /#message-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|current)\b/gi;

export function remapConversationOutline(markdown: string, ids: Map<string, string>): string {
  return markdown.replace(MESSAGE_LINK_PATTERN, (match, id: string) => ids.has(id) ? `#message-${ids.get(id)}` : match);
}

export function remapConversationMap(graph: ConversationMap, ids: Map<string, string>): ConversationMap {
  const remap = (id: string | null) => id === null ? null : ids.get(id) ?? id;
  return { topics: graph.topics, main_path_end_id: remap(graph.main_path_end_id),
    nodes: graph.nodes.map((node) => ({ ...node, id: remap(node.id)!, parent_id: remap(node.parent_id) })) };
}
