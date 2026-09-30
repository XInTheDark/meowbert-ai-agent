import { query } from "../../lib/db.js";
import type {
  SwarmChannelSummary,
  LoadedWorkflowRunContext
} from "./context.js";
import { loadSwarmChannels } from "./context.js";
import { hasDualSwarmRole, resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";

export function channelsForSwarmTarget(
  context: LoadedWorkflowRunContext,
  channels: SwarmChannelSummary[],
  targetSwarm?: SwarmTarget
): SwarmChannelSummary[] {
  const target = resolveSwarmTarget(context, targetSwarm);
  if (!hasDualSwarmRole(context)) return channels;
  const memberIds = new Set(target.memberTaskIds);
  const nodeChannelIds = new Set(Object.values(
    (context.config.swarmChannelIds ?? {}) as Record<string, unknown>
  ).filter((id): id is string => typeof id === "string"));
  return channels.filter((channel) => channel.id === target.channelId
    || (!nodeChannelIds.has(channel.id)
      && channel.kind !== "global"
      && channel.member_task_ids.every((taskId) => memberIds.has(taskId))));
}

export async function resolveSwarmChannelForAgent(
  context: LoadedWorkflowRunContext,
  requestedChannelId: string,
  targetSwarm?: SwarmTarget
): Promise<SwarmChannelSummary> {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) {
    throw new Error("Swarm channels are only available for swarm agents.");
  }

  const normalizedRequestedChannelId = requestedChannelId.trim();
  if (normalizedRequestedChannelId.length === 0) {
    throw new Error("channel_id is required.");
  }

  const allChannels = await loadSwarmChannels(context.workflowTaskId, context.currentAgent.id);
  if (context.swarm) {
    context.swarm.channels = allChannels;
  }
  const channels = channelsForSwarmTarget(context, allChannels, targetSwarm);
  const target = resolveSwarmTarget(context, targetSwarm);

  const exactMatch = channels.find((channel) => channel.id === normalizedRequestedChannelId);
  if (exactMatch) {
    return exactMatch;
  }

  const normalizedAlias = normalizedRequestedChannelId.toLowerCase();
  if (normalizedAlias === "global") {
    const nodeChannel = channels.find((channel) => channel.id === target.channelId);
    if (nodeChannel) return nodeChannel;
  }
  const aliasMatches = channels.filter((channel) => {
    const normalizedKind = typeof channel.kind === "string" ? channel.kind.toLowerCase() : "";
    const normalizedTitle = channel.title?.trim().toLowerCase() ?? null;
    return normalizedKind === normalizedAlias || normalizedTitle === normalizedAlias;
  });

  if (aliasMatches.length === 1) {
    return aliasMatches[0];
  }

  if (aliasMatches.length > 1) {
    throw new Error("Channel alias is ambiguous. Use the exact channel_id from list_channels.");
  }

  throw new Error(
    "You are not a member of that channel. Use the exact channel_id from list_channels, or use a known channel alias like \"global\"."
  );
}
