import type { TaskExecutionJob } from "@meowbert/shared";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { manageSwarmWorkers, resolveWorkerIds } from "./agent-swarm-management.js";
import { pauseSwarmAgent } from "./agent-swarm-mailbox.js";
import { sendSwarmChannelMessage } from "./agent-swarm-messaging.js";
import { formatSwarmAgentLabel } from "./shared.js";
import { resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";

// Assigning work is a channel post plus an explicit start, so the named workers always act on it
// even when the post lands in passive Global. With wait, the leader resumes once they all finish.
export async function assignSwarmWorkers(input: {
  context: LoadedWorkflowRunContext;
  targetSwarm?: SwarmTarget;
  workers: string[];
  message: string;
  wait: boolean;
  triggerSource: TaskExecutionJob["triggerSource"];
  selectionUserId: string | null;
}): Promise<{ messageNo: number; assigned: string[]; started: string[]; paused: boolean; escalation: string | null }> {
  const { context } = input;
  const target = resolveSwarmTarget(context, input.targetSwarm);
  if (!target.isLeader) throw new Error("Only an Agent Swarm node leader can assign work to workers.");
  const nodeWorkers = context.agents.filter((agent) => target.workerTaskIds.includes(agent.task_id));
  const taskIds = resolveWorkerIds(nodeWorkers, input.workers);
  if (taskIds.length === 0) throw new Error("Name at least one worker to assign.");
  const labels = taskIds.map((taskId) => {
    const worker = nodeWorkers.find((agent) => agent.task_id === taskId)!;
    return formatSwarmAgentLabel(worker.role, worker.slot_index, worker.title);
  });

  const sent = await sendSwarmChannelMessage(context, {
    targetSwarm: input.targetSwarm,
    channelId: target.channelId ?? "global",
    message: `To ${labels.join(", ")}:\n\n${input.message.trim()}`
  });
  const managed = await manageSwarmWorkers({
    context,
    targetSwarm: input.targetSwarm,
    start: taskIds,
    stop: [],
    grantBudget: [],
    viewOnly: false
  });
  const pause = input.wait
    ? await pauseSwarmAgent({
      context,
      triggerSource: input.triggerSource,
      selectionUserId: input.selectionUserId,
      status: `Waiting for ${labels.join(", ")}.`,
      targetSwarm: input.targetSwarm,
      waitingForTaskIds: taskIds
    })
    : null;
  return {
    messageNo: sent.messageNo,
    assigned: labels,
    started: managed.started,
    paused: pause !== null,
    escalation: pause?.escalation ?? null
  };
}
