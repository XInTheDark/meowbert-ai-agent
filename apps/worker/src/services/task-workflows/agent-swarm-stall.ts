import { query, withTransaction } from "../../lib/db.js";
import { appendMessage, getNewestLeafMessageId } from "../agent-db/index.js";
import { emitTaskEvent } from "../runtime/events.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import type { StoredSwarmPause } from "./agent-swarm-dependencies.js";
import {
  loadSwarmPausesInTx,
  loadSwarmStallInTx,
  saveSwarmStallInTx,
  takeSwarmPauseInTx
} from "./agent-swarm-pause-store.js";
import { enqueueSwarmWakes } from "./agent-swarm-pause-state.js";
import { asObject, formatSwarmAgentLabel, isSwarmTaskActiveStatus } from "./shared.js";

// After every active agent pauses, the runtime nudges one leader once. If the swarm stalls again
// before any other agent has run, it stops nudging and hands the task back to the user.
type StallOutcome =
  | { kind: "nudge"; taskId: string; pause: StoredSwarmPause }
  | { kind: "escalate"; leaderStatus: string | null };

function resolveStartedSwarmWorkerTaskIds(
  context: LoadedWorkflowRunContext,
  currentState: Record<string, unknown>
): Set<string> {
  if (Array.isArray(currentState.startedSwarmWorkerTaskIds)) {
    return new Set(currentState.startedSwarmWorkerTaskIds.filter((id): id is string => typeof id === "string"));
  }
  return currentState.workersStartedAt
    ? new Set(context.agents.filter((agent) => agent.role === "worker").map((agent) => agent.task_id))
    : new Set();
}

function resolvePendingNestedLeaderTaskIds(context: LoadedWorkflowRunContext): string[] {
  const pendingNodeIds = context.swarm?.pendingNestedSwarmNodeIds ?? [];
  if (pendingNodeIds.length === 0) return [];

  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  const taskIdByLeafId = new Map(context.agents.flatMap((agent) => {
    const leafId = agent.state_json?.swarmLeafId;
    return typeof leafId === "string" ? [[leafId, agent.task_id] as const] : [];
  }));
  return pendingNodeIds.flatMap((nodeId) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    const leaderTaskId = typeof node?.leaderLeafId === "string" ? taskIdByLeafId.get(node.leaderLeafId) : null;
    return leaderTaskId ? [leaderTaskId] : [];
  });
}

export function buildSwarmStallEscalation(leaderStatus: string | null): string {
  return [
    "The swarm has stalled: every agent is paused and nothing is scheduled to wake them. Reply with direction to continue.",
    leaderStatus ? `Leader's last status: ${leaderStatus}` : null
  ].filter(Boolean).join("\n\n");
}

async function decideStallOutcome(context: LoadedWorkflowRunContext, leaderTaskId: string): Promise<StallOutcome | null> {
  return withTransaction(async (client) => {
    const workflowResult = await client.query<{ phase: string | null; state_json: Record<string, unknown> | null }>(
      `SELECT state_json, phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") return null;
    const currentState = asObject(workflowResult.rows[0]?.state_json);
    const pauses = await loadSwarmPausesInTx(client, context.workflowTaskId);
    const startedWorkerTaskIds = resolveStartedSwarmWorkerTaskIds(context, currentState);
    const activeTaskIds = context.agents
      .filter((agent) => isSwarmTaskActiveStatus(agent.status)
        && (agent.role === "leader" || startedWorkerTaskIds.has(agent.task_id)))
      .map((agent) => agent.task_id);
    if (activeTaskIds.length === 0 || activeTaskIds.some((taskId) => !pauses[taskId])) return null;

    const stall = await loadSwarmStallInTx(client, context.workflowTaskId);
    if (stall?.escalated) return null;
    if (stall) {
      await saveSwarmStallInTx(client, context.workflowTaskId, { ...stall, escalated: true });
      return { kind: "escalate", leaderStatus: pauses[leaderTaskId]?.status ?? null };
    }

    const stalledTaskId = [...resolvePendingNestedLeaderTaskIds(context), leaderTaskId]
      .find((taskId) => activeTaskIds.includes(taskId) && pauses[taskId]);
    if (!stalledTaskId) return null;
    const pause = await takeSwarmPauseInTx(client, context.workflowTaskId, stalledTaskId);
    if (!pause) return null;
    await saveSwarmStallInTx(client, context.workflowTaskId, { nudgedTaskId: stalledTaskId, escalated: false });
    return { kind: "nudge", taskId: stalledTaskId, pause };
  });
}

// The root leader's own run reports the escalation through its pause; otherwise post it to the
// user's task here.
async function escalateOutsideLeaderRun(workflowTaskId: string, text: string): Promise<void> {
  await appendMessage(workflowTaskId, "assistant", { text }, {
    parentMessageId: await getNewestLeafMessageId(workflowTaskId)
  });
  const updated = await query(
    `UPDATE tasks SET status = 'awaiting_input', updated_at = now()
      WHERE id = $1
        AND status = 'queued'
        AND NOT EXISTS (SELECT 1 FROM task_runs WHERE task_id = $1 AND ended_at IS NULL)`,
    [workflowTaskId]
  );
  if ((updated.rowCount ?? 0) > 0) {
    await emitTaskEvent(workflowTaskId, "status", { status: "awaiting_input" });
  }
}

// Returns the escalation text when the current run belongs to the root leader and must hand the
// task back to the user itself.
export async function maybeResumeStalledSwarm(context: LoadedWorkflowRunContext): Promise<string | null> {
  if (context.workflowType !== "agent_swarm" || context.phase === "completed") return null;
  const leaderTaskId = context.agents.find((agent) => agent.role === "leader")?.task_id ?? null;
  if (!leaderTaskId) return null;

  const outcome = await decideStallOutcome(context, leaderTaskId);
  if (!outcome) return null;
  if (outcome.kind === "escalate") {
    const text = buildSwarmStallEscalation(outcome.leaderStatus);
    if (context.taskId === leaderTaskId) return text;
    await escalateOutsideLeaderRun(context.workflowTaskId, text);
    return null;
  }

  const agent = context.agents.find((candidate) => candidate.task_id === outcome.taskId);
  const label = agent ? formatSwarmAgentLabel(agent.role, agent.slot_index, agent.title) : outcome.taskId;
  await enqueueSwarmWakes(
    context,
    [{ taskId: outcome.taskId, ...outcome.pause }],
    `${label} resumed because every active swarm agent was paused before the workflow completed.`
  );
  return null;
}
