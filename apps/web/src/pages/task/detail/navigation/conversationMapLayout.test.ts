import { describe, expect, it } from "vitest";
import { layoutConversationMap, mapTopicGroups } from "./conversationMapLayout";
import type { ConversationMap, ConversationTurn } from "@meowbert/shared/conversation-organization";

const turns: ConversationTurn[] = ["a", "b", "c", "d"].map((id, index) => ({ id, message_ids: [id], user_message_id: null,
  summary: id, has_summary: true, completed: true, index: index + 1 }));
const graph: ConversationMap = { nodes: [
  { id: "a", parent_id: null, topic_id: null }, { id: "b", parent_id: "a", topic_id: null },
  { id: "c", parent_id: "b", topic_id: null }, { id: "d", parent_id: "b", topic_id: null }
], topics: [], main_path_end_id: "d" };

describe("conversation map placement", () => {
  it("puts the main discussion on a spine and a detour beside it", () => {
    const layout = layoutConversationMap(turns, graph, new Set());
    expect(layout.filter((item) => item.main).map((item) => item.turn.id)).toEqual(["a", "b", "d"]);
    expect(layout[2].x).toBeGreaterThan(layout[1].x);
    expect(layout[3].x).toBe(layout[1].x);
  });
  it("does not move existing nodes when appending a turn", () => {
    const before = layoutConversationMap(turns, graph, new Set());
    const after = layoutConversationMap([...turns, { ...turns[0], id: "e", index: 5 }], graph, new Set());
    expect(after.slice(0, 4).map(({ x, y }) => [x, y])).toEqual(before.map(({ x, y }) => [x, y]));
  });
  it("collapses descendants and keeps an expansion control on their parent", () => {
    const layout = layoutConversationMap(turns, graph, new Set(["b"]));
    expect(layout.map((item) => item.turn.id)).toEqual(["a", "b"]);
    expect(layout[1].childCount).toBe(2);
  });
  it("keeps an expansion control before a model map exists", () => {
    const layout = layoutConversationMap(turns, null, new Set(["b"]));
    expect(layout.map((item) => item.turn.id)).toEqual(["a", "b"]);
    expect(layout[1].childCount).toBe(1);
  });
  it("makes room for an expanded summary without moving earlier rows or changing lanes", () => {
    const before = layoutConversationMap(turns, graph, new Set());
    const after = layoutConversationMap(turns, graph, new Set(), { id: "b", height: 190 });
    expect(after[0]).toEqual(before[0]);
    expect(after[1].y).toBe(before[1].y);
    expect(after[1].height).toBe(190);
    expect(after.slice(2).map((item, index) => item.y - before[index + 2].y)).toEqual([118, 118]);
    expect(after.map((item) => item.x)).toEqual(before.map((item) => item.x));
    expect(after[2].y).toBeGreaterThan(after[1].y + after[1].height);
  });
  it("keeps a topic box around all of an expanded summary", () => {
    const withTopic = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, topic_id: "lesson" })) };
    const positions = layoutConversationMap(turns, withTopic, new Set(), { id: "d", height: 220 });
    const last = positions.at(-1)!;
    const group = mapTopicGroups(positions).find((item) => item.x === last.x - 10 && item.y <= last.y && item.y + item.height >= last.y + last.height);
    expect(group).toBeDefined();
  });
});
