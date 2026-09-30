import { z } from "zod";
import { loadConversationNavigation, loadConversationPublicIndex, type ConversationPublicMessage, type ConversationMap } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { getNewestLeafMessageId } from "./messages.js";
import { loadTaskOutputFiles } from "./task-output-files.js";
import { ensureTaskHistoryWarm } from "../tasks/task-history.js";

export const organizationHistoryArgumentsSchema = z.object({
  task_id: z.string().uuid().nullable().optional(),
  max_messages: z.number().int().min(1).max(50).nullable().optional(),
  view: z.enum(["messages", "navigation"]).nullable().optional(),
  cursor: z.string().uuid().nullable().optional(),
  branch_leaf_id: z.string().uuid().nullable().optional(),
  message_ids: z.array(z.string().uuid()).min(1).max(50).nullable().optional()
});

export async function readOrganizedTaskHistory(input: z.infer<typeof organizationHistoryArgumentsSchema>, context: {
  taskId: string; environmentId: string; branchLeafId: string | null; allowOtherTasks: boolean;
  staged?: { outline: string | null; graph: ConversationMap | null; outlineChanged: boolean; mapChanged: boolean };
}) {
  const taskId = input.task_id ?? context.taskId;
  if (taskId !== context.taskId && !context.allowOtherTasks) throw new Error("Cross-task history is disabled.");
  const target = await query<{ id: string; title: string | null; status: string }>(
    `SELECT id, title, status FROM tasks WHERE id = $1 AND environment_id = $2
     AND (id = $3 OR (trashed_at IS NULL AND is_incognito = false))`, [taskId, context.environmentId, context.taskId]);
  if (!target.rows.length) throw new Error("Task not found or not accessible in this project.");
  const leaf = input.branch_leaf_id ?? (taskId === context.taskId ? context.branchLeafId : await getNewestLeafMessageId(taskId));
  if (leaf) {
    const valid = await query("SELECT id FROM task_messages WHERE id = $1 AND task_id = $2", [leaf, taskId]);
    if (!valid.rows.length) throw new Error("Conversation branch not found.");
  }
  await ensureTaskHistoryWarm(taskId);
  const header = { task_id: taskId, title: target.rows[0].title, status: target.rows[0].status, branch_leaf_id: leaf,
    files: await loadTaskOutputFiles({ query }, taskId) };
  const limit = input.max_messages ?? 50;
  if (input.view === "navigation") {
    const navigation = await loadConversationNavigation({ query }, taskId, leaf);
    if (context.staged && taskId === context.taskId && leaf === context.branchLeafId) {
      if (context.staged.outlineChanged && context.staged.outline !== null) navigation.outline = { markdown: context.staged.outline, message_id: "current" };
      if (context.staged.mapChanged && context.staged.graph) navigation.map = { graph: context.staged.graph, message_id: "current" };
    }
    const page = historyPage(navigation.turns, limit, input.cursor);
    return { ...header, outline: navigation.outline, map: navigation.map && {
      ...navigation.map, graph: { ...navigation.map.graph,
        nodes: navigation.map.graph.nodes.filter((node) => page.items.some((turn) => turn.id === node.id) || (node.id === "current" && !page.next_cursor)) }
    }, turns: page.items, next_cursor: page.next_cursor };
  }
  const index = await loadConversationPublicIndex({ query }, taskId, leaf);
  const page = historyPage(index, limit, input.cursor);
  const ids = input.message_ids ?? page.items.map((message) => message.id);
  if (ids.some((id) => !index.some((message) => message.id === id))) throw new Error("Message is not in this conversation branch.");
  const messages = await query<ConversationPublicMessage>(
    `SELECT m.id, m.role, COALESCE(m.content_json->>'text', '') AS text,
      m.content_json->>'turn_summary' AS summary, m.created_at, m.parent_message_id
     FROM unnest($2::uuid[]) WITH ORDINALITY AS requested(id, ord)
     JOIN task_messages m ON m.id = requested.id AND m.task_id = $1 ORDER BY requested.ord`, [taskId, ids]);
  return { ...header, messages: messages.rows, next_cursor: input.message_ids ? null : page.next_cursor };
}

function historyPage<T extends { id: string }>(items: T[], limit: number, cursor?: string | null) {
  const position = cursor ? items.findIndex((item) => item.id === cursor) : -1;
  if (cursor && position === -1) throw new Error("Cursor is not in this conversation branch.");
  const page = items.slice(position + 1, position + 1 + limit);
  return { items: page, next_cursor: position + 1 + limit < items.length ? page.at(-1)?.id ?? null : null };
}
