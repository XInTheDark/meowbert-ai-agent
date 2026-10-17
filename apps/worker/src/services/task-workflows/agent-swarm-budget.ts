import {
  calculateAgentSwarmLeaderAllowance,
  isAgentSwarmPoolLow,
  AGENT_SWARM_MINIMUM_INFERENCE_TOKENS
} from "@meowbert/shared";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";

// Every member of a Swarm node, leader and workers alike, draws each inference step from the node's
// shared pool (`unassigned_tokens`). The node's protected reserve (`system_reserve_tokens`) is kept
// for its leader to wrap up once the pool is spent, or once the leader has used its own share.

export interface SwarmInferenceReservation {
  reservationId: string;
  requestedTokens: number;
  nodeId: string;
  workflowAgentId: string;
  role: "leader" | "worker";
  recovery: boolean;
  // The pool still had budget, but the leader had already spent its own share on its own work.
  overLeaderAllowance: boolean;
  // The node's pool just ran low for this agent; it should report what it has and wrap up.
  lowBudget: boolean;
  runId: string | null;
}

export type SwarmQuotaReason = "budget_exhausted" | "deadline_reached" | "worker_budget_exhausted" | "parent_cancelled";

export class SwarmQuotaError extends Error {
  readonly reason: SwarmQuotaReason;
  readonly minimumTokens: number;
  // Whether the node's leader (or, for a leader, its parent) should hear about this stop.
  notify: boolean;

  constructor(reason: SwarmQuotaReason, minimumTokens: number, message: string, notify = true) {
    super(message);
    this.name = "SwarmQuotaError";
    this.reason = reason;
    this.minimumTokens = minimumTokens;
    this.notify = notify;
  }
}

export interface SwarmQuotaMember {
  nodeId: string;
  workflowAgentId: string;
  role: "leader" | "worker";
  nodeLeaderTaskId: string;
  parentLeaderTaskId: string | null;
}

interface LockedNode {
  status: string;
  deadline_at: string | null;
  allocated_tokens: string | number;
  system_reserve_tokens: string | number;
  unassigned_tokens: string | number;
}

interface LockedMember {
  status: string;
  spent_tokens: string | number;
  reserved_tokens: string | number;
}

type FundingSource = "pool" | "over_allowance" | "recovery" | "none";

export function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function readStringList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null;
}

// Resolves the node this agent is spending from. A dual-role agent leads one node and works in its
// parent; it spends from the node it leads.
export async function loadSwarmQuotaMember(context: LoadedWorkflowRunContext, preferPaused = false): Promise<SwarmQuotaMember> {
  const result = await query<{
    node_id: string;
    workflow_agent_id: string;
    role: "leader" | "worker";
    node_leader_task_id: string;
    parent_leader_task_id: string | null;
  }>(
    `SELECT n.id AS node_id,
            member.id AS workflow_agent_id,
            cm.role,
            n.leader_task_id AS node_leader_task_id,
            parent_agent.task_id AS parent_leader_task_id
       FROM task_workflow_swarm_nodes n
       JOIN task_workflow_swarm_node_members cm ON cm.node_id = n.id
       JOIN task_workflow_agents member ON member.id = cm.workflow_agent_id
       LEFT JOIN task_workflow_swarm_nodes parent_node ON parent_node.id = n.parent_node_id
       LEFT JOIN task_workflow_swarm_node_members parent_member
         ON parent_member.node_id = parent_node.id AND parent_member.role = 'leader'
       LEFT JOIN task_workflow_agents parent_agent ON parent_agent.id = parent_member.workflow_agent_id
      WHERE n.workflow_task_id = $1
        AND member.task_id = $2
      ORDER BY CASE WHEN n.status = CASE WHEN $5::boolean THEN 'paused' ELSE 'active' END THEN 0 ELSE 1 END,
               CASE
                 WHEN COALESCE(array_length($3::text[], 1), 0) > 0 AND n.node_key = ANY($3::text[]) THEN 0
                 WHEN COALESCE(array_length($4::text[], 1), 0) > 0 AND n.node_key = ANY($4::text[]) THEN 1
                 WHEN n.parent_node_id IS NULL THEN 2
                 ELSE 3
               END,
               n.depth DESC
      LIMIT 1`,
    [
      context.workflowTaskId,
      context.taskId,
      readStringList(context.currentAgent?.state_json?.swarmLeaderNodeIds),
      readStringList(context.currentAgent?.state_json?.swarmNodeIds),
      preferPaused
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Swarm quota node could not be resolved for this agent.");
  return {
    nodeId: row.node_id,
    workflowAgentId: row.workflow_agent_id,
    role: row.role,
    nodeLeaderTaskId: row.node_leader_task_id,
    parentLeaderTaskId: row.parent_leader_task_id
  };
}

async function loadMinimumStepTokens(context: LoadedWorkflowRunContext): Promise<number> {
  const result = await query<{ weighted_tokens: string | number | null }>(
    `SELECT weighted_tokens
       FROM user_token_usage_events
      WHERE task_id = $1
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT 1`,
    [context.taskId]
  );
  return Math.max(AGENT_SWARM_MINIMUM_INFERENCE_TOKENS, numberValue(result.rows[0]?.weighted_tokens));
}

async function markNodePaused(nodeId: string, reason: SwarmQuotaReason): Promise<void> {
  await query(
    `UPDATE task_workflow_swarm_nodes
        SET status = 'paused', paused_reason = $2, updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [nodeId, reason]
  );
}

// Returns true only for the first worker of the node to stop on an empty pool, so its leader hears
// about the empty pool once rather than once per worker.
async function markWorkerOutOfBudget(member: SwarmQuotaMember): Promise<boolean> {
  const result = await query<{ newly_paused: boolean; others_paused: string | number }>(
    `WITH paused AS (
       UPDATE task_workflow_swarm_node_members
          SET status = 'paused', updated_at = now()
        WHERE node_id = $1 AND workflow_agent_id = $2 AND status = 'active'
        RETURNING node_id
     )
     SELECT EXISTS (SELECT 1 FROM paused) AS newly_paused,
            (SELECT COUNT(*) FROM task_workflow_swarm_node_members
              WHERE node_id = $1 AND role = 'worker' AND status = 'paused' AND workflow_agent_id <> $2) AS others_paused`,
    [member.nodeId, member.workflowAgentId]
  );
  const row = result.rows[0];
  return Boolean(row?.newly_paused) && numberValue(row?.others_paused) === 0;
}

async function persistQuotaStop(member: SwarmQuotaMember, error: SwarmQuotaError): Promise<void> {
  if (error.reason === "worker_budget_exhausted") {
    error.notify = await markWorkerOutOfBudget(member);
  } else if (error.reason === "budget_exhausted" || error.reason === "deadline_reached") {
    await markNodePaused(member.nodeId, error.reason);
  }
}

async function lockNode(client: PoolClient, nodeId: string, step: number): Promise<LockedNode> {
  const locked = await client.query<LockedNode>(
    `SELECT status, deadline_at, allocated_tokens, system_reserve_tokens, unassigned_tokens
       FROM task_workflow_swarm_nodes
      WHERE id = $1
      FOR UPDATE`,
    [nodeId]
  );
  const node = locked.rows[0];
  if (!node) throw new SwarmQuotaError("parent_cancelled", step, "Swarm node could not be found.", false);
  if (node.deadline_at && Date.parse(node.deadline_at) <= Date.now()) {
    throw new SwarmQuotaError(
      "deadline_reached",
      step,
      "Swarm deadline reached. The current node is paused and its parent was notified.",
      node.status === "active"
    );
  }
  if (node.status !== "active") {
    throw new SwarmQuotaError(
      node.status === "paused" ? "budget_exhausted" : "parent_cancelled",
      step,
      `Swarm node is ${node.status} and cannot start another inference.`,
      false
    );
  }
  return node;
}

async function lockMember(client: PoolClient, member: SwarmQuotaMember, step: number): Promise<LockedMember> {
  const locked = await client.query<LockedMember>(
    `SELECT status, spent_tokens, reserved_tokens
       FROM task_workflow_swarm_node_members
      WHERE node_id = $1 AND workflow_agent_id = $2
      FOR UPDATE`,
    [member.nodeId, member.workflowAgentId]
  );
  const row = locked.rows[0];
  if (!row || row.status === "cancelled" || row.status === "completed") {
    throw new SwarmQuotaError("parent_cancelled", step, "This Swarm agent was stopped and cannot start another inference.", false);
  }
  return row;
}

// What the leader's workers have spent plus what its child nodes were granted.
async function loadDelegatedTokens(client: PoolClient, nodeId: string): Promise<number> {
  const delegated = await client.query<{ delegated_tokens: string | number }>(
    `SELECT (SELECT COALESCE(SUM(spent_tokens + reserved_tokens), 0) FROM task_workflow_swarm_node_members
              WHERE node_id = $1 AND role = 'worker')
          + (SELECT COALESCE(SUM(allocated_tokens), 0) FROM task_workflow_swarm_nodes
              WHERE parent_node_id = $1) AS delegated_tokens`,
    [nodeId]
  );
  return numberValue(delegated.rows[0]?.delegated_tokens);
}

// Workers spend only from the pool. A leader spends from the pool within its share; past its share,
// or once the pool is empty, its steps come from the protected reserve. Its share alone never stops
// a leader: when the reserve cannot cover the step, the pool still does.
async function chooseFunding(client: PoolClient, input: {
  member: SwarmQuotaMember;
  node: LockedNode;
  leaderSpentTokens: number;
  step: number;
  recovery: boolean;
}): Promise<FundingSource> {
  const poolCovers = numberValue(input.node.unassigned_tokens) >= input.step;
  const reserveCovers = numberValue(input.node.system_reserve_tokens) >= input.step;
  if (input.member.role === "worker") return poolCovers && !input.recovery ? "pool" : "none";
  if (input.recovery || !poolCovers) return reserveCovers ? "recovery" : "none";
  if (!reserveCovers) return "pool";
  const allowance = calculateAgentSwarmLeaderAllowance({
    allocatedTokens: numberValue(input.node.allocated_tokens),
    delegatedTokens: await loadDelegatedTokens(client, input.member.nodeId)
  });
  return input.leaderSpentTokens + input.step <= allowance ? "pool" : "over_allowance";
}

function exhaustedError(member: SwarmQuotaMember, step: number): SwarmQuotaError {
  return member.role === "worker"
    ? new SwarmQuotaError(
      "worker_budget_exhausted",
      step,
      `This Swarm node's shared budget is spent. Another step needs ${step} weighted tokens.`
    )
    : new SwarmQuotaError(
      "budget_exhausted",
      step,
      `This Swarm node's budget, including its protected reserve, is spent. Another step needs ${step} weighted tokens.`
    );
}

// Tells each agent once that its node's pool is about to run out.
async function claimLowBudgetNotice(client: PoolClient, member: SwarmQuotaMember, poolTokens: number, step: number): Promise<boolean> {
  const members = await client.query<{ count: string | number }>(
    `SELECT COUNT(*) AS count FROM task_workflow_swarm_node_members
      WHERE node_id = $1 AND status IN ('active', 'paused')`,
    [member.nodeId]
  );
  if (!isAgentSwarmPoolLow({ poolTokens, minimumStepTokens: step, memberCount: numberValue(members.rows[0]?.count) })) {
    return false;
  }
  const claimed = await client.query(
    `UPDATE task_workflow_swarm_node_members
        SET low_budget_notified = true, updated_at = now()
      WHERE node_id = $1 AND workflow_agent_id = $2 AND NOT low_budget_notified`,
    [member.nodeId, member.workflowAgentId]
  );
  return (claimed.rowCount ?? 0) > 0;
}

async function debitReservationInTx(client: PoolClient, input: {
  context: LoadedWorkflowRunContext;
  member: SwarmQuotaMember;
  step: number;
  fromReserve: boolean;
  runId: string | null;
}): Promise<string> {
  const { member, step, fromReserve } = input;
  await client.query(
    `UPDATE task_workflow_swarm_nodes
        SET reserved_tokens = reserved_tokens + $2,
            unassigned_tokens = CASE WHEN $3 THEN unassigned_tokens ELSE unassigned_tokens - $2 END,
            system_reserve_tokens = CASE WHEN $3 THEN system_reserve_tokens - $2 ELSE system_reserve_tokens END,
            updated_at = now()
      WHERE id = $1`,
    [member.nodeId, step, fromReserve]
  );
  await client.query(
    `UPDATE task_workflow_swarm_node_members
        SET reserved_tokens = reserved_tokens + $3, status = 'active', updated_at = now()
      WHERE node_id = $1 AND workflow_agent_id = $2`,
    [member.nodeId, member.workflowAgentId, step]
  );
  const reservation = await client.query<{ id: string }>(
    `INSERT INTO task_workflow_swarm_quota_reservations
      (workflow_task_id, node_id, workflow_agent_id, run_id, quota_generation, requested_tokens, recovery)
     SELECT $1, n.id, $2, $3, n.generation, $4, $5
       FROM task_workflow_swarm_nodes n
      WHERE n.id = $6
     RETURNING id`,
    [input.context.workflowTaskId, member.workflowAgentId, input.runId, step, fromReserve, member.nodeId]
  );
  await client.query(
    `INSERT INTO task_workflow_swarm_quota_ledger
      (workflow_task_id, node_id, workflow_agent_id, run_id, kind, amount_tokens, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [input.context.workflowTaskId, member.nodeId, member.workflowAgentId, input.runId,
      fromReserve ? "recovery" : "reservation", step, JSON.stringify({ recovery: fromReserve })]
  );
  return reservation.rows[0].id;
}

async function reserveInTx(client: PoolClient, input: {
  context: LoadedWorkflowRunContext;
  member: SwarmQuotaMember;
  step: number;
  recovery: boolean;
  runId: string | null;
}): Promise<SwarmInferenceReservation> {
  const { member, step } = input;
  const node = await lockNode(client, member.nodeId, step);
  const lockedMember = await lockMember(client, member, step);
  const funding = await chooseFunding(client, {
    member,
    node,
    leaderSpentTokens: numberValue(lockedMember.spent_tokens) + numberValue(lockedMember.reserved_tokens),
    step,
    recovery: input.recovery
  });
  if (funding === "none") throw exhaustedError(member, step);
  const fromReserve = funding !== "pool";
  const reservationId = await debitReservationInTx(client, { ...input, fromReserve });
  const lowBudget = !fromReserve
    && await claimLowBudgetNotice(client, member, numberValue(node.unassigned_tokens) - step, step);
  return {
    reservationId,
    requestedTokens: step,
    nodeId: member.nodeId,
    workflowAgentId: member.workflowAgentId,
    role: member.role,
    recovery: fromReserve,
    overLeaderAllowance: funding === "over_allowance",
    lowBudget,
    runId: input.runId
  };
}

export async function reserveSwarmInference(
  context: LoadedWorkflowRunContext,
  recovery = false,
  runId?: string,
  estimatedStepTokens = AGENT_SWARM_MINIMUM_INFERENCE_TOKENS
): Promise<SwarmInferenceReservation | null> {
  if (context.workflowType !== "agent_swarm") return null;
  if (numberValue(context.config.tokenBudget) <= 0) return null;
  const member = await loadSwarmQuotaMember(context);
  const step = Math.max(await loadMinimumStepTokens(context), Math.ceil(estimatedStepTokens));
  if (recovery && member.role !== "leader") {
    throw new SwarmQuotaError("worker_budget_exhausted", step, "Only a node leader can use the protected reserve.", false);
  }
  try {
    return await withTransaction((client) => reserveInTx(client, { context, member, step, recovery, runId: runId ?? null }));
  } catch (error) {
    // Pauses are written after the reservation transaction rolls back, so they always persist.
    if (error instanceof SwarmQuotaError) await persistQuotaStop(member, error);
    throw error;
  }
}

// Returns an unused reservation to the pool or reserve it was drawn from.
async function refundReservationInTx(client: PoolClient, reservation: SwarmInferenceReservation, requestedTokens: number, recovery: boolean): Promise<void> {
  await client.query(
    `UPDATE task_workflow_swarm_node_members
        SET reserved_tokens = GREATEST(0, reserved_tokens - $3), updated_at = now()
      WHERE node_id = $1 AND workflow_agent_id = $2`,
    [reservation.nodeId, reservation.workflowAgentId, requestedTokens]
  );
  await client.query(
    `UPDATE task_workflow_swarm_nodes
        SET reserved_tokens = GREATEST(0, reserved_tokens - $2),
            unassigned_tokens = CASE WHEN $3 THEN unassigned_tokens ELSE unassigned_tokens + $2 END,
            system_reserve_tokens = CASE WHEN $3 THEN system_reserve_tokens + $2 ELSE system_reserve_tokens END,
            updated_at = now()
      WHERE id = $1`,
    [reservation.nodeId, requestedTokens, recovery]
  );
}

// Charges the actual cost. An unused part returns to its source; an overrun is taken from the same
// source while it lasts and recorded as debt beyond that.
async function chargeReservationInTx(
  client: PoolClient,
  reservation: SwarmInferenceReservation,
  requestedTokens: number,
  settledTokens: number,
  recovery: boolean
): Promise<void> {
  await client.query(
    `UPDATE task_workflow_swarm_node_members
        SET reserved_tokens = GREATEST(0, reserved_tokens - $3),
            spent_tokens = spent_tokens + $4,
            updated_at = now()
      WHERE node_id = $1 AND workflow_agent_id = $2`,
    [reservation.nodeId, reservation.workflowAgentId, requestedTokens, settledTokens]
  );
  await client.query(
    `UPDATE task_workflow_swarm_nodes
        SET reserved_tokens = GREATEST(0, reserved_tokens - $2),
            spent_tokens = spent_tokens + $3,
            unassigned_tokens = CASE WHEN $4 THEN unassigned_tokens ELSE GREATEST(0, unassigned_tokens + $2 - $3) END,
            system_reserve_tokens = CASE WHEN $4 THEN GREATEST(0, system_reserve_tokens + $2 - $3) ELSE system_reserve_tokens END,
            debt_tokens = debt_tokens + GREATEST(0, $3 - $2 - CASE WHEN $4 THEN system_reserve_tokens ELSE unassigned_tokens END),
            updated_at = now()
      WHERE id = $1`,
    [reservation.nodeId, requestedTokens, settledTokens, recovery]
  );
}

export async function settleSwarmInference(
  context: LoadedWorkflowRunContext,
  reservation: SwarmInferenceReservation,
  actualTokens: number
): Promise<boolean> {
  const settledTokens = Math.max(0, Math.floor(actualTokens));
  return withTransaction(async (client) => {
    const reservationResult = await client.query<{
      requested_tokens: string | number;
      recovery: boolean;
      status: string;
      quota_generation: number;
      node_generation: number;
      node_status: string;
      deadline_at: string | null;
    }>(
      `SELECT r.requested_tokens, r.recovery, r.status, r.quota_generation,
              n.generation AS node_generation, n.status AS node_status, n.deadline_at
         FROM task_workflow_swarm_quota_reservations r
         JOIN task_workflow_swarm_nodes n ON n.id = r.node_id
        WHERE r.id = $1 AND r.workflow_task_id = $2
        FOR UPDATE OF r, n`,
      [reservation.reservationId, context.workflowTaskId]
    );
    const row = reservationResult.rows[0];
    if (!row || row.status !== "active") return false;
    const requestedTokens = numberValue(row.requested_tokens);
    const late = row.deadline_at !== null && Date.parse(row.deadline_at) <= Date.now();
    const quarantined = late
      || row.quota_generation !== row.node_generation
      || row.node_status === "cancelled"
      || row.node_status === "completed";
    if (late && row.node_status === "active") {
      await client.query(
        `UPDATE task_workflow_swarm_nodes
            SET status = 'paused', paused_reason = 'deadline_reached', updated_at = now()
          WHERE id = $1`,
        [reservation.nodeId]
      );
    }
    await client.query(
      `UPDATE task_workflow_swarm_quota_reservations
          SET settled_tokens = $2, status = $3, settled_at = now()
        WHERE id = $1`,
      [reservation.reservationId, settledTokens, quarantined ? "expired" : "settled"]
    );
    if (quarantined) {
      await refundReservationInTx(client, reservation, requestedTokens, row.recovery);
    } else {
      await chargeReservationInTx(client, reservation, requestedTokens, settledTokens, row.recovery);
    }
    await client.query(
      `INSERT INTO task_workflow_swarm_quota_ledger
        (workflow_task_id, node_id, workflow_agent_id, run_id, kind, amount_tokens, metadata_json)
       VALUES ($1, $2, $3, $4, 'settlement', $5, $6::jsonb)`,
      [context.workflowTaskId, reservation.nodeId, reservation.workflowAgentId, reservation.runId, settledTokens,
        JSON.stringify({ requestedTokens, quarantined, late })]
    );
    return !quarantined;
  });
}

export async function releaseSwarmInference(
  context: LoadedWorkflowRunContext,
  reservation: SwarmInferenceReservation
): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ requested_tokens: string | number; recovery: boolean; status: string }>(
      `SELECT requested_tokens, recovery, status
         FROM task_workflow_swarm_quota_reservations
        WHERE id = $1 AND workflow_task_id = $2
        FOR UPDATE`,
      [reservation.reservationId, context.workflowTaskId]
    );
    const row = result.rows[0];
    if (!row || row.status !== "active") return;
    await client.query(
      `UPDATE task_workflow_swarm_quota_reservations
          SET status = 'released', settled_at = now()
        WHERE id = $1`,
      [reservation.reservationId]
    );
    await refundReservationInTx(client, reservation, numberValue(row.requested_tokens), row.recovery);
  });
}
