import { withTransaction } from "../../lib/db.js";
import type { LoadedWorkflowRunContext } from "./context.js";
import { resolveSwarmTarget, type SwarmTarget, type ResolvedSwarmTarget } from "./swarm-target.js";
import { asObject, formatSwarmAgentLabel, resolveAgentSwarmReviewRounds } from "./shared.js";

function isRootSwarm(context: LoadedWorkflowRunContext, target: ResolvedSwarmTarget): boolean {
  return !target.nodeId || target.nodeId === asObject(context.config.compiledSwarm).rootNodeId;
}

function requiredReviewRounds(context: LoadedWorkflowRunContext, target: ResolvedSwarmTarget): number {
  if (isRootSwarm(context, target)) return resolveAgentSwarmReviewRounds(context);
  const nodes = asObject(context.config.compiledSwarm).nodes;
  const node = Array.isArray(nodes) ? nodes.map(asObject).find((entry) => entry.id === target.nodeId) : null;
  return typeof node?.reviewRounds === "number" ? node.reviewRounds : 0;
}

function resolveReviewer(context: LoadedWorkflowRunContext, reviewer: string, target: ResolvedSwarmTarget) {
  const normalized = reviewer.trim().toLowerCase();
  const worker = context.agents.find((agent) => target.workerTaskIds.includes(agent.task_id) && (
    agent.task_id.toLowerCase() === normalized
    || formatSwarmAgentLabel(agent.role, agent.slot_index, agent.title).toLowerCase() === normalized
  ));
  if (!worker) throw new Error(`Reviewers must be existing swarm workers: ${reviewer}`);
  return worker;
}

function resolveFinalReviewer(context: LoadedWorkflowRunContext, reviewer: string, target: ResolvedSwarmTarget) {
  const selected = resolveReviewer(context, reviewer, target);
  const qualityReviewers = context.agents.filter((agent) =>
    target.workerTaskIds.includes(agent.task_id) && agent.state_json.agentPresetMode === "quality_control_reviewer"
  );
  if (qualityReviewers.length > 0 && !qualityReviewers.some((agent) => agent.task_id === selected.task_id)) {
    throw new Error("A Quality Control worker must provide this swarm's final review.");
  }
  return selected;
}

export function canRecordSwarmReview(context: LoadedWorkflowRunContext | null): boolean {
  if (context?.workflowType !== "agent_swarm" || !context.currentAgent) return false;
  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  if (nodes.length === 0) {
    return context.currentAgent.role === "leader"
      && (context.swarm?.completedReviewRounds ?? 0) < resolveAgentSwarmReviewRounds(context);
  }
  const leafId = context.currentAgent.state_json?.swarmLeafId;
  return nodes.some((node) => node.leaderLeafId === leafId
    && typeof node.reviewRounds === "number"
    && node.reviewRounds > (node.id === compiled.rootNodeId
      ? context.swarm?.completedReviewRounds ?? 0
      : 0));
}

export function canRecordSwarmFinalReview(context: LoadedWorkflowRunContext | null): boolean {
  if (context?.workflowType !== "agent_swarm" || !context.currentAgent) return false;
  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  if (nodes.length === 0) {
    return context.currentAgent.role === "leader"
      && requiresSwarmFinalReview(context)
      && !context.swarm?.finalReview?.approved;
  }
  const leafId = context.currentAgent.state_json?.swarmLeafId;
  return nodes.some((node) => node.leaderLeafId === leafId
    && Array.isArray(node.workerLeafIds) && node.workerLeafIds.length > 0
    && (node.id !== compiled.rootNodeId || context.swarm?.finalReview?.approved !== true));
}

export function requiresSwarmFinalReview(context: LoadedWorkflowRunContext | null): boolean {
  if (context?.workflowType !== "agent_swarm") return false;
  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  const root = nodes.find((node) => node.id === compiled.rootNodeId);
  return root
    ? Array.isArray(root.workerLeafIds) && root.workerLeafIds.length > 0
    : context.agents.some((agent) => agent.role === "worker");
}

export function hasApprovedSwarmFinalReview(context: LoadedWorkflowRunContext | null): boolean {
  return !requiresSwarmFinalReview(context) || context?.swarm?.finalReview?.approved === true;
}

export async function recordSwarmReviewRound(input: {
  context: LoadedWorkflowRunContext;
  targetSwarm?: SwarmTarget;
  reviewer: string;
  summary: string;
}): Promise<{ completedRounds: number; requiredRounds: number; reviewerLabel: string }> {
  const target = resolveSwarmTarget(input.context, input.targetSwarm);
  if (!target.isLeader) {
    throw new Error("Only the Agent Swarm leader can record a review round.");
  }
  const requiredRounds = requiredReviewRounds(input.context, target);
  if (requiredRounds === 0) throw new Error("This swarm has no required review rounds.");
  const reviewer = resolveReviewer(input.context, input.reviewer, target);
  const completedRounds = await withTransaction(async (client) => {
    const result = await client.query<{ state_json: Record<string, unknown> | null }>(
      `SELECT state_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [input.context.workflowTaskId]
    );
    const state = result.rows[0]?.state_json ?? {};
    const byNode = asObject(state.reviewRoundsByNode);
    const storedReviews = isRootSwarm(input.context, target) ? state.reviewRounds : byNode[target.nodeId!];
    const reviews = Array.isArray(storedReviews) ? storedReviews : [];
    if (reviews.length >= requiredRounds) throw new Error("All required review rounds are already recorded.");
    const nextReviews = [...reviews, {
      reviewerTaskId: reviewer.task_id,
      summary: input.summary,
      createdAt: new Date().toISOString()
    }];
    await client.query(
      `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [input.context.workflowTaskId, JSON.stringify(isRootSwarm(input.context, target)
        ? { ...state, reviewRounds: nextReviews }
        : { ...state, reviewRoundsByNode: { ...byNode, [target.nodeId!]: nextReviews } })]
    );
    return nextReviews.length;
  });
  if (isRootSwarm(input.context, target) && input.context.swarm) input.context.swarm.completedReviewRounds = completedRounds;
  return { completedRounds, requiredRounds, reviewerLabel: formatSwarmAgentLabel(reviewer.role, reviewer.slot_index, reviewer.title) };
}

export async function recordSwarmFinalReview(input: {
  context: LoadedWorkflowRunContext;
  targetSwarm?: SwarmTarget;
  reviewer: string;
  approved: boolean;
  summary: string;
}): Promise<{ reviewerLabel: string; approved: boolean }> {
  const target = resolveSwarmTarget(input.context, input.targetSwarm);
  if (!target.isLeader) {
    throw new Error("Only the Agent Swarm leader can record the final review.");
  }
  const reviewer = resolveFinalReviewer(input.context, input.reviewer, target);
  const reviewerLabel = formatSwarmAgentLabel(reviewer.role, reviewer.slot_index, reviewer.title);
  const finalReview = await withTransaction(async (client) => {
    const result = await client.query<{ state_json: Record<string, unknown> | null }>(
      `SELECT state_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [input.context.workflowTaskId]
    );
    const state = result.rows[0]?.state_json ?? {};
    const cycleStartMessageNo = typeof state.cycleStartMessageNo === "number" ? state.cycleStartMessageNo : 0;
    const reviewerMessages = await client.query(
      `SELECT 1
         FROM task_workflow_messages m
         JOIN task_workflow_agents a ON a.id = m.sender_workflow_agent_id
        WHERE m.workflow_task_id = $1 AND a.task_id = $2 AND m.message_no > $3
        LIMIT 1`,
      [input.context.workflowTaskId, reviewer.task_id, cycleStartMessageNo]
    );
    if ((reviewerMessages.rowCount ?? 0) === 0) {
      throw new Error(`${reviewerLabel} has not posted a review in the swarm. Send it the complete proposed response and wait for its reply.`);
    }
    const nextFinalReview = {
      reviewerTaskId: reviewer.task_id,
      reviewerLabel,
      approved: input.approved,
      summary: input.summary,
      createdAt: new Date().toISOString()
    };
    await client.query(
      `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [input.context.workflowTaskId, JSON.stringify(isRootSwarm(input.context, target)
        ? { ...state, finalReview: nextFinalReview }
        : { ...state, finalReviewsByNode: {
          ...asObject(state.finalReviewsByNode), [target.nodeId!]: nextFinalReview
        } })]
    );
    return nextFinalReview;
  });
  if (isRootSwarm(input.context, target) && input.context.swarm) input.context.swarm.finalReview = finalReview;
  return { reviewerLabel, approved: input.approved };
}
