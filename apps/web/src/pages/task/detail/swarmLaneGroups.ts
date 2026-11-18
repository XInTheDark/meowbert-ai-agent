import type { AgentSwarmLaneView } from "@meowbert/shared/agent-swarm-view";
import type { TaskMessage } from "../../../lib/types";

export const ACTIVE_SWARM_LANE_STATUSES = new Set<AgentSwarmLaneView["status"]>(["queued", "running", "waiting"]);

export interface SwarmLaneNode {
  lane: AgentSwarmLaneView;
  children: SwarmLaneNode[];
}

// The leader's lanes from one split, diverge or check call, shown together under the message that
// made the call.
export interface SwarmLaneGroup {
  key: string;
  createdAt: string;
  anchorMessageId: string | null;
  nodes: SwarmLaneNode[];
}

function buildNodes(lanes: AgentSwarmLaneView[], parentId: string): SwarmLaneNode[] {
  return lanes
    .filter((lane) => lane.parentId === parentId)
    .map((lane) => ({ lane, children: buildNodes(lanes, lane.id) }));
}

// The call that started lanes is saved with the message written when the leader's run parked, right
// after the lanes were created, so a group belongs under the first message at or after its lanes.
export function findLaneGroupAnchor(messages: TaskMessage[], createdAt: string): string | null {
  const at = new Date(createdAt).getTime();
  let anchor: TaskMessage | null = null;
  for (const message of messages) {
    const time = new Date(message.created_at).getTime();
    if (time >= at && (!anchor || time < new Date(anchor.created_at).getTime())) anchor = message;
  }
  return anchor?.id ?? null;
}

// Which part of the conversation is loaded. Without it every group is placed.
export interface LoadedMessageWindow {
  loading: boolean;
  hasOlder: boolean;
  hasNewer: boolean;
}

// A group whose anchor may sit on a page that is not loaded would otherwise pile up under the
// nearest loaded message, so it waits until that page loads.
function isGroupOnLoadedPage(createdAt: string, messages: TaskMessage[], window: LoadedMessageWindow): boolean {
  if (messages.length === 0) return !window.loading && !window.hasOlder && !window.hasNewer;
  const at = new Date(createdAt).getTime();
  const times = messages.map((message) => new Date(message.created_at).getTime());
  if (window.hasOlder && at < Math.min(...times)) return false;
  if (window.hasNewer && at > Math.max(...times)) return false;
  return true;
}

export function buildSwarmLaneGroups(
  lanes: AgentSwarmLaneView[],
  rootTaskId: string,
  messages: TaskMessage[],
  loadedWindow?: LoadedMessageWindow
): SwarmLaneGroup[] {
  const groups = new Map<string, SwarmLaneGroup>();
  for (const node of buildNodes(lanes, rootTaskId)) {
    const key = node.lane.groupId ?? node.lane.id;
    const group = groups.get(key);
    if (group) {
      group.nodes.push(node);
      continue;
    }
    groups.set(key, { key, createdAt: node.lane.createdAt, anchorMessageId: null, nodes: [node] });
  }
  return [...groups.values()]
    .filter((group) => !loadedWindow || isGroupOnLoadedPage(group.createdAt, messages, loadedWindow))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .map((group) => ({ ...group, anchorMessageId: findLaneGroupAnchor(messages, group.createdAt) }));
}

// The leader's lanes that submitted and can still be resumed, for the header list.
export function listDormantSwarmLanes(lanes: AgentSwarmLaneView[], rootTaskId: string): AgentSwarmLaneView[] {
  return lanes.filter((lane) => lane.parentId === rootTaskId && lane.resumable);
}
