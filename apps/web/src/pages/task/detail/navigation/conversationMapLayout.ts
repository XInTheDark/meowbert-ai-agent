import type { ConversationMap, ConversationTurn } from "@meowbert/shared/conversation-organization";

export const MAP_ROW_HEIGHT = 106;
export const MAP_NODE_HEIGHT = 72;
export const MAP_LANE_WIDTH = 236;
export interface MapPosition { turn: ConversationTurn; x: number; y: number; height: number; parentId: string | null; topicId: string | null; main: boolean; childCount: number; }

export function layoutConversationMap(turns: ConversationTurn[], graph: ConversationMap | null, collapsed: Set<string>, expanded?: { id: string; height: number } | null): MapPosition[] {
  const byId = new Map(graph?.nodes.map((node) => [node.id, node]));
  const main = new Set<string>();
  let cursor = graph?.main_path_end_id ?? null;
  while (cursor && !main.has(cursor)) { main.add(cursor); cursor = byId.get(cursor)?.parent_id ?? null; }
  const positions = new Map<string, MapPosition>();
  const hidden = new Set<string>();
  const lanes = new Map<string, number>();
  const continued = new Set<string>();
  let nextLane = 1;
  let nextY = 44;
  turns.forEach((turn, index) => {
    const node = byId.get(turn.id);
    const parentId = node?.parent_id ?? (node ? null : turns[index - 1]?.id ?? null);
    const parent = parentId ? positions.get(parentId) : null;
    if (parentId && (collapsed.has(parentId) || hidden.has(parentId))) {
      if (parent) parent.childCount += 1;
      hidden.add(turn.id); return;
    }
    const onMain = main.has(turn.id) || !graph;
    const lane = onMain ? 0 : parent && !parent.main && !continued.has(parentId!) ? lanes.get(parentId!)! : nextLane++;
    if (parentId) continued.add(parentId);
    lanes.set(turn.id, lane);
    if (parent) parent.childCount += 1;
    const height = expanded?.id === turn.id ? Math.max(MAP_NODE_HEIGHT, expanded.height) : MAP_NODE_HEIGHT;
    positions.set(turn.id, { turn, x: 24 + lane * MAP_LANE_WIDTH, y: nextY, height,
      parentId, topicId: node?.topic_id ?? null, main: onMain, childCount: 0 });
    nextY += height + MAP_ROW_HEIGHT - MAP_NODE_HEIGHT;
  });
  return [...positions.values()];
}

export function mapTopicGroups(positions: MapPosition[]) {
  const groups: Array<{ topicId: string; x: number; y: number; height: number }> = [];
  const previousByLane = new Map<number, typeof groups[number]>();
  for (const item of positions) {
    if (!item.topicId) { previousByLane.delete(item.x); continue; }
    const previous = previousByLane.get(item.x);
    if (previous?.topicId === item.topicId && item.y <= previous.y + previous.height + 32) {
      previous.height = item.y - previous.y + item.height + 16;
    } else {
      const group = { topicId: item.topicId, x: item.x - 10, y: item.y - 24, height: item.height + 40 };
      groups.push(group); previousByLane.set(item.x, group);
    }
  }
  return groups;
}
