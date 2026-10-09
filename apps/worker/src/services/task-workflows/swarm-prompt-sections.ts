import type { LoadedWorkflowRunContext } from "./context.js";
import { asObject, formatSwarmAgentLabel } from "./shared.js";
import { hasDualSwarmRole, resolveSwarmTarget } from "./swarm-target.js";
import { listAgentSwarmNodeTypes } from "./agent-swarm-node-types.js";

// Facts about this particular swarm, formatted for the Agent Swarm guide and live state.

export function buildDualSwarmRolePrompt(context: LoadedWorkflowRunContext): string | null {
  if (!hasDualSwarmRole(context)) return null;
  const outer = resolveSwarmTarget(context, "outer");
  const inner = resolveSwarmTarget(context, "inner");
  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  const innerNode = nodes.find((node) => node.id === inner.nodeId);
  const innerReviewRounds = typeof innerNode?.reviewRounds === "number" ? innerNode.reviewRounds : 0;
  return [
    "### Your two swarms",
    `- Outer swarm: ${outer.nodeId}; channel_id ${outer.channelId ?? "unavailable"}. You are ${outer.isLeader ? "its leader" : "a member"}.`,
    `- Inner swarm: ${inner.nodeId}; channel_id ${inner.channelId ?? "unavailable"}. You are its leader.`,
    "- Every swarm tool call must set `target_swarm` to `outer` or `inner`.",
    "- `assign_worker`, `swarm_manage`, and review tools are leader-only in the selected swarm. Use them for inner; use them for outer only if you also lead outer.",
    "- You are the only inner-swarm member who sees the outer swarm's messages. Inner workers do not receive outer context unless you pass it on.",
    "- Represent the inner swarm in both directions: carry relevant outer goals, constraints, decisions, and corrections inward, and carry the inner swarm's findings, disagreements, uncertainty, and blockers outward. Do not filter out material information or disagreement. When meaning or priority is unclear, ask the other swarm before committing the group.",
    `- The inner swarm has ${innerReviewRounds} configured independent review round(s). Record its reviews with target \`inner\`.`,
    "- When the inner swarm's work is done, publish its result to outer with `submit_swarm_output` targeted at `inner`."
  ].join("\n");
}

export const SWARM_BUDGET_PROMPT = [
  "### Budget",
  "- Swarm budgets count weighted input, output, and reasoning tokens. Each worker has its own lease; the node's protected reserve is for leader recovery and synthesis.",
  "- Check `swarm_budget_status` before delegating. A child node keeps 10% of its grant as a protected reserve and starts its workers with at most another 10%; the rest stays unassigned for its leader to spend or delegate. Child grants below 1M weighted tokens are rejected.",
  "- Size budgets from your own remaining budget and how hard the work really is. One inference step costs roughly 10k–50k weighted tokens and grows with context. Even a quick check needs 1–2M; real investigation or implementation often needs far more, well past 10M when the work is open-ended or tricky. Estimate pessimistically, and keep enough for your own coordination and synthesis.",
  "- Workers start with a small lease, so fund them for the work you assign with `swarm_manage` and `grant_budget`.",
  "- When the current workers cannot cover useful independent work, spawn a fitting child node with `swarm_spawn_node` and enough budget for the assignment. If your node has no workers, spawn one before substantive work; if no node type or budget allows it, report that blocker instead of working alone.",
  "- If a child or worker exhausts its allocation, inspect usage, then grant enough (`swarm_grant_budget` for a child, `swarm_manage` with `grant_budget` for a worker), cancel the child with `swarm_cancel_node`, or synthesize what you have. A late provider result is discarded after the deadline, although usage is charged."
].join("\n");

export function buildSwarmNodeTypesPrompt(context: LoadedWorkflowRunContext): string {
  const types = listAgentSwarmNodeTypes(context.config.dynamicNodeTypes);
  const lines = types.length === 0
    ? ["- No node types are configured for this swarm."]
    : types.map((type) => {
      const workers = type.modelAllocations.map((item) => `${item.workerCount} ${item.agentId}`).join(", ") || "none";
      return `- ${type.id}: ${type.name} — ${type.description} · leader ${type.leaderAgentId} · workers ${workers} · ${type.reviewRounds} review rounds`;
    });
  return ["### Node types you can spawn", ...lines].join("\n");
}

export function buildSwarmChannelsPromptText(context: LoadedWorkflowRunContext): string {
  const channels = context.swarm?.channels ?? [];
  if (channels.length === 0) {
    return "- No channels yet. Use `list_channels` and `create_channel` as needed.";
  }

  return channels
    .map((channel) => {
      const membersText = channel.member_task_ids.length > 0
        ? channel.member_task_ids.join(", ")
        : "(none)";
      return [
        `- ${channel.title ?? channel.kind} (${channel.kind})`,
        `channel_id ${channel.id}`,
        `latest #${channel.latest_message_no}`,
        `member_task_ids ${membersText}`
      ].join(" · ");
    })
    .join("\n");
}

export function buildSwarmPeerPromptText(context: LoadedWorkflowRunContext): string {
  const peers = context.swarm?.peerTaskDirs ?? [];
  if (peers.length === 0) {
    return "- No peer agents found.";
  }

  return peers
    .map((peer) => {
      const titleText = peer.title ? ` · title ${peer.title}` : "";
      return [
        `- ${formatSwarmAgentLabel(peer.role, peer.slotIndex, peer.title ?? peer.taskId)}`,
        `task_id ${peer.taskId}${titleText}`,
        `task dir ${peer.taskDir}`
      ].join(" · ");
    })
    .join("\n");
}

export function buildSwarmRosterText(context: LoadedWorkflowRunContext): string {
  const compiled = context.config.compiledSwarm;
  if (!compiled || typeof compiled !== "object" || Array.isArray(compiled)) {
    return "- Flat swarm: the leader and workers collaborate through Global.";
  }
  const record = compiled as { nodes?: unknown; leaves?: unknown };
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const leaves = Array.isArray(record.leaves) ? record.leaves : [];
  const leafById = new Map(leaves.map((entry) => {
    const leaf = entry as { id?: unknown; name?: unknown; mode?: unknown };
    return [typeof leaf.id === "string" ? leaf.id : "", leaf];
  }));
  const describeLeaf = (leafId: unknown): string => {
    const leaf = typeof leafId === "string" ? leafById.get(leafId) : undefined;
    const name = typeof leaf?.name === "string" ? leaf.name : "Unknown agent";
    const mode = leaf?.mode === "quality_control_reviewer" ? "Quality review specialized agent" : "Agent";
    return `${name} — ${mode}`;
  };
  return nodes.map((entry) => {
    const node = entry as { parentNodeId?: unknown; title?: unknown; leaderLeafId?: unknown; workerLeafIds?: unknown[] };
    const prefix = typeof node.parentNodeId === "string" ? "  " : "";
    const title = typeof node.title === "string" ? node.title : "Agent Swarm";
    const workers = Array.isArray(node.workerLeafIds) ? node.workerLeafIds : [];
    return [
      `${prefix}- ${title}`,
      `${prefix}  - Leader: ${describeLeaf(node.leaderLeafId)}`,
      ...workers.map((worker, index) => `${prefix}  - Worker ${index + 1}: ${describeLeaf(worker)}`)
    ].join("\n");
  }).join("\n");
}

export function isQualityReviewSwarmAgent(context: LoadedWorkflowRunContext): boolean {
  return context.currentAgent?.state_json?.agentPresetMode === "quality_control_reviewer";
}
