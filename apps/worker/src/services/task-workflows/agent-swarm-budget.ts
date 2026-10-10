import {
  calculateAgentSwarmLeaderAllowance,
  calculateAgentSwarmMinimumGrant,
  AGENT_SWARM_MINIMUM_CHILD_NODE_TOKENS,
  AGENT_SWARM_MINIMUM_INFERENCE_TOKENS
} from "@meowbert/shared";
import type { TaskExecutionJob } from "@meowbert/shared";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import { wakePausedSwarmAgent } from "./agent-swarm-mailbox.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";

export interface SwarmBudgetChildStatus {
  nodeId: string;
  title: string;
  status: string;
  remainingTokens: number;
  deadlineAt: string | null;
  minimumGrantTokens: number;
}

export interface SwarmBudgetWorkerStatus {
  taskId: string;
  status: string;
  remainingTokens: number;
}

// Only what a leader acts on: its own runway, what it can hand out, and each direct report.
export interface SwarmBudgetStatus {
  status: string;
  remainingTokens: number;
  unassignedTokens: number;
  deadlineAt: string | null;
  minimumSpawnAllocationTokens: number;
  workers: SwarmBudgetWorkerStatus[];
  children: SwarmBudgetChildStatus[];
}

export interface SwarmInferenceReservation {
  reservationId: string;
  requestedTokens: number;
  nodeId: string;
  workflowAgentId: string;
  recovery: boolean;
  // The leader had budget left in the pool but had already spent its own share on its own work.
  overLeaderAllowance: boolean;
  runId: string | null;
}

export class SwarmQuotaError extends Error {
  readonly reason: "budget_exhausted" | "deadline_reached" | "worker_budget_exhausted" | "parent_cancelled";
  readonly minimumTokens: number;

  constructor(reason: SwarmQuotaError["reason"], minimumTokens: number, message: string) {
    super(message);
    this.name = "SwarmQuotaError";
    this.reason = reason;
    this.minimumTokens = minimumTokens;
  }
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

async function loadCurrentNode(context: LoadedWorkflowRunContext, preferPaused = false): Promise<{
  nodeId: string;
  workflowAgentId: string;
  role: "leader" | "worker";
  leaseTokens: number;
  memberSpentTokens: number;
  memberReservedTokens: number;
  memberStatus: string;
  allocatedTokens: number;
  spentTokens: number;
  reservedTokens: number;
  systemReserveTokens: number;
  unassignedTokens: number;
  debtTokens: number;
  status: string;
  deadlineAt: string | null;
  nodeLeaderTaskId: string;
  parentLeaderTaskId: string | null;
}> {
  const result = await query<{
    node_id: string;
    workflow_agent_id: string;
    role: "leader" | "worker";
    lease_tokens: string | number;
    member_spent_tokens: string | number;
    member_reserved_tokens: string | number;
    member_status: string;
    allocated_tokens: string | number;
    spent_tokens: string | number;
    reserved_tokens: string | number;
    system_reserve_tokens: string | number;
    unassigned_tokens: string | number;
    debt_tokens: string | number;
    status: string;
    deadline_at: string | null;
    node_leader_task_id: string;
    parent_leader_task_id: string | null;
  }>(
    `SELECT n.id AS node_id,
            member.id AS workflow_agent_id,
            member.role,
            cm.lease_tokens,
            cm.spent_tokens AS member_spent_tokens,
            cm.reserved_tokens AS member_reserved_tokens,
            cm.status AS member_status,
            n.allocated_tokens,
            n.spent_tokens,
            n.reserved_tokens,
            n.system_reserve_tokens,
            n.unassigned_tokens,
            n.debt_tokens,
            n.status,
            n.deadline_at,
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
      Array.isArray(context.currentAgent?.state_json?.swarmLeaderNodeIds)
        ? context.currentAgent.state_json.swarmLeaderNodeIds.filter((value): value is string => typeof value === "string")
        : null,
      Array.isArray(context.currentAgent?.state_json?.swarmNodeIds)
        ? context.currentAgent.state_json.swarmNodeIds.filter((value): value is string => typeof value === "string")
        : null,
      preferPaused
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Swarm quota node could not be resolved for this agent.");
  return {
    nodeId: row.node_id,
    workflowAgentId: row.workflow_agent_id,
    role: row.role,
    leaseTokens: numberValue(row.lease_tokens),
    memberSpentTokens: numberValue(row.member_spent_tokens),
    memberReservedTokens: numberValue(row.member_reserved_tokens),
    memberStatus: row.member_status,
    allocatedTokens: numberValue(row.allocated_tokens),
    spentTokens: numberValue(row.spent_tokens),
    reservedTokens: numberValue(row.reserved_tokens),
    systemReserveTokens: numberValue(row.system_reserve_tokens),
    unassignedTokens: numberValue(row.unassigned_tokens),
    debtTokens: numberValue(row.debt_tokens),
    status: row.status,
    deadlineAt: row.deadline_at,
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

async function markNodePaused(nodeId: string, reason: SwarmQuotaError["reason"]): Promise<void> {
  await query(
    `UPDATE task_workflow_swarm_nodes
        SET status = 'paused', paused_reason = $2, updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [nodeId, reason]
  );
}

async function markWorkerPaused(nodeId: string, workflowAgentId: string): Promise<void> {
  await query(
    `UPDATE task_workflow_swarm_node_members
        SET status = 'paused', updated_at = now()
      WHERE node_id = $1 AND workflow_agent_id = $2 AND status = 'active'`,
    [nodeId, workflowAgentId]
  );
}

// Where a leader's next step comes from when its own lease is short. Within its allowance it draws
// from the unassigned pool as usual. Beyond it, the step comes from the protected recovery reserve,
// whose notice tells the leader to delegate or wrap up. The allowance alone never pauses a leader:
// when the reserve cannot cover the step, the unassigned pool still does.
async function chooseLeaderFunding(client: PoolClient, input: {
  nodeId: string;
  allocatedTokens: number;
  leaderDrawnTokens: number;
  shortfall: number;
  minimumStepTokens: number;
  unassignedTokens: number;
  systemReserveTokens: number;
}): Promise<"unassigned" | "over_allowance" | "recovery" | "none"> {
  const unassignedCovers = input.unassignedTokens >= input.shortfall;
  const reserveCovers = input.systemReserveTokens >= input.minimumStepTokens;
  if (unassignedCovers && reserveCovers) {
    const delegated = await client.query<{ delegated_tokens: string | number }>(
      `SELECT (SELECT COALESCE(SUM(lease_tokens), 0) FROM task_workflow_swarm_node_members
                WHERE node_id = $1 AND role = 'worker')
            + (SELECT COALESCE(SUM(allocated_tokens), 0) FROM task_workflow_swarm_nodes
                WHERE parent_node_id = $1) AS delegated_tokens`,
      [input.nodeId]
    );
    const allowance = calculateAgentSwarmLeaderAllowance({
      allocatedTokens: input.allocatedTokens,
      delegatedTokens: numberValue(delegated.rows[0]?.delegated_tokens)
    });
    return input.leaderDrawnTokens + input.shortfall <= allowance ? "unassigned" : "over_allowance";
  }
  if (unassignedCovers) return "unassigned";
  return reserveCovers ? "recovery" : "none";
}

export async function reserveSwarmInference(
  context: LoadedWorkflowRunContext,
  recovery = false,
  runId?: string,
  estimatedStepTokens = AGENT_SWARM_MINIMUM_INFERENCE_TOKENS
): Promise<SwarmInferenceReservation | null> {
  if (context.workflowType !== "agent_swarm") return null;
  if (numberValue(context.config.tokenBudget) <= 0) return null;
  const current = await loadCurrentNode(context);
  const minimumStepTokens = Math.max(await loadMinimumStepTokens(context), Math.ceil(estimatedStepTokens));
  if (current.deadlineAt && Date.parse(current.deadlineAt) <= Date.now()) {
    await markNodePaused(current.nodeId, "deadline_reached");
    throw new SwarmQuotaError(
      "deadline_reached",
      minimumStepTokens,
      "Swarm deadline reached. The current node is paused and its parent was notified."
    );
  }
  if (current.status !== "active") {
    throw new SwarmQuotaError(
      current.status === "paused" ? "budget_exhausted" : "parent_cancelled",
      minimumStepTokens,
      `Swarm node is ${current.status} and cannot start another inference.`
    );
  }
  if (current.role === "worker" && current.memberStatus !== "active") {
    throw new SwarmQuotaError(
      "worker_budget_exhausted",
      minimumStepTokens,
      "This worker lease is paused and cannot start another inference."
    );
  }

  // Member leases are carved from the node's operating budget, so the node reserve
  // has already been removed and must not be subtracted a second time here.
  const available = current.leaseTokens - current.memberSpentTokens - current.memberReservedTokens;
  const operatingAvailable = Math.max(0, available);
  if (recovery && current.role !== "leader") {
    throw new SwarmQuotaError(
      "worker_budget_exhausted",
      minimumStepTokens,
      "Only a node leader can use the protected recovery reserve."
    );
  }
  const leaderAvailable = current.role === "leader"
    ? Math.max(operatingAvailable + current.unassignedTokens, current.systemReserveTokens)
    : operatingAvailable;
  if ((recovery ? current.systemReserveTokens : leaderAvailable) < minimumStepTokens) {
    const reason = current.role === "worker" ? "worker_budget_exhausted" : "budget_exhausted";
    if (current.role === "worker") {
      await markWorkerPaused(current.nodeId, current.workflowAgentId);
    } else {
      await markNodePaused(current.nodeId, reason);
    }
    throw new SwarmQuotaError(
      reason,
      minimumStepTokens,
      `Swarm budget exhausted. Minimum required for the next inference is ${minimumStepTokens} weighted tokens.`
    );
  }

  try {
    return await withTransaction(async (client) => {
      const locked = await client.query<{
        status: string;
        deadline_at: string | null;
        allocated_tokens: string | number;
        system_reserve_tokens: string | number;
        unassigned_tokens: string | number;
      }>(
        `SELECT status, deadline_at, allocated_tokens, system_reserve_tokens, unassigned_tokens
           FROM task_workflow_swarm_nodes
          WHERE id = $1
          FOR UPDATE`,
        [current.nodeId]
      );
      const lockedNode = locked.rows[0];
      if (!lockedNode || lockedNode.status !== "active") {
        throw new SwarmQuotaError("budget_exhausted", minimumStepTokens, "Swarm node changed before its inference reservation could be created.");
      }
      if (lockedNode.deadline_at && Date.parse(lockedNode.deadline_at) <= Date.now()) {
        await client.query(
          `UPDATE task_workflow_swarm_nodes
              SET status = 'paused', paused_reason = 'deadline_reached', updated_at = now()
            WHERE id = $1 AND status = 'active'`,
          [current.nodeId]
        );
        throw new SwarmQuotaError("deadline_reached", minimumStepTokens, "Swarm deadline reached before its inference reservation could be created.");
      }
      const lockedMember = await client.query<{
        status: string;
        lease_tokens: string | number;
        spent_tokens: string | number;
        reserved_tokens: string | number;
      }>(
        `SELECT status, lease_tokens, spent_tokens, reserved_tokens
           FROM task_workflow_swarm_node_members
          WHERE node_id = $1 AND workflow_agent_id = $2
          FOR UPDATE`,
        [current.nodeId, current.workflowAgentId]
      );
      const member = lockedMember.rows[0];
      if (!member || member.status !== "active") {
        const reason = current.role === "worker" ? "worker_budget_exhausted" : "budget_exhausted";
        throw new SwarmQuotaError(reason, minimumStepTokens, "This Swarm member lease is paused and cannot start another inference.");
      }
      const lockedOperatingAvailable = numberValue(member.lease_tokens)
        - numberValue(member.spent_tokens)
        - numberValue(member.reserved_tokens);
      const shortfall = Math.max(0, minimumStepTokens - lockedOperatingAvailable);
      const funding = !recovery && current.role === "leader" && shortfall > 0
        ? await chooseLeaderFunding(client, {
          nodeId: current.nodeId,
          allocatedTokens: numberValue(lockedNode.allocated_tokens),
          leaderDrawnTokens: numberValue(member.lease_tokens),
          shortfall,
          minimumStepTokens,
          unassignedTokens: numberValue(lockedNode.unassigned_tokens),
          systemReserveTokens: numberValue(lockedNode.system_reserve_tokens)
        })
        : "none";
      if (funding === "unassigned") {
        await client.query(
          `UPDATE task_workflow_swarm_node_members
              SET lease_tokens = lease_tokens + $2, updated_at = now()
            WHERE node_id = $1 AND workflow_agent_id = $3`,
          [current.nodeId, shortfall, current.workflowAgentId]
        );
        await client.query(
          `UPDATE task_workflow_swarm_nodes
              SET unassigned_tokens = unassigned_tokens - $2, updated_at = now()
            WHERE id = $1`,
          [current.nodeId, shortfall]
        );
      }
      const useRecovery = recovery || funding === "recovery" || funding === "over_allowance";
      const lockedAvailable = useRecovery
        ? numberValue(lockedNode.system_reserve_tokens)
        : lockedOperatingAvailable + (funding === "unassigned" ? shortfall : 0);
      if (recovery && current.role !== "leader") {
        throw new SwarmQuotaError("worker_budget_exhausted", minimumStepTokens, "Only a node leader can use the protected recovery reserve.");
      }
      if (lockedAvailable < minimumStepTokens) {
        if (current.role === "worker") {
          await client.query(
            `UPDATE task_workflow_swarm_node_members
                SET status = 'paused', updated_at = now()
              WHERE node_id = $1 AND workflow_agent_id = $2 AND status = 'active'`,
            [current.nodeId, current.workflowAgentId]
          );
        } else {
          await client.query(
            `UPDATE task_workflow_swarm_nodes
                SET status = 'paused', paused_reason = $2, updated_at = now()
              WHERE id = $1 AND status = 'active'`,
            [current.nodeId, "budget_exhausted"]
          );
        }
        throw new SwarmQuotaError(
          current.role === "worker" ? "worker_budget_exhausted" : "budget_exhausted",
          minimumStepTokens,
          `Swarm budget exhausted. Minimum required for the next inference is ${minimumStepTokens} weighted tokens.`
        );
      }
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO task_workflow_swarm_quota_reservations
          (workflow_task_id, node_id, workflow_agent_id, run_id, quota_generation, requested_tokens, recovery)
         SELECT $1, n.id, $2, $3, n.generation, $4, $5
           FROM task_workflow_swarm_nodes n
         WHERE n.id = $6
         RETURNING id`,
        [context.workflowTaskId, current.workflowAgentId, runId ?? null, minimumStepTokens, useRecovery, current.nodeId]
      );
      await client.query(
        `UPDATE task_workflow_swarm_node_members
            SET reserved_tokens = reserved_tokens + $2, updated_at = now()
          WHERE node_id = $1 AND workflow_agent_id = $3`,
        [current.nodeId, minimumStepTokens, current.workflowAgentId]
      );
      await client.query(
        `UPDATE task_workflow_swarm_nodes
            SET reserved_tokens = reserved_tokens + $2,
                system_reserve_tokens = CASE WHEN $3 THEN system_reserve_tokens - $2 ELSE system_reserve_tokens END,
                updated_at = now()
          WHERE id = $1`,
        [current.nodeId, minimumStepTokens, useRecovery]
      );
      await client.query(
        `INSERT INTO task_workflow_swarm_quota_ledger
          (workflow_task_id, node_id, workflow_agent_id, run_id, kind, amount_tokens, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [context.workflowTaskId, current.nodeId, current.workflowAgentId, runId ?? null, useRecovery ? "recovery" : "reservation", minimumStepTokens, JSON.stringify({ recovery: useRecovery })]
      );
      return {
        reservationId: reservation.rows[0].id,
        requestedTokens: minimumStepTokens,
        nodeId: current.nodeId,
        workflowAgentId: current.workflowAgentId,
        recovery: useRecovery,
        overLeaderAllowance: funding === "over_allowance",
        runId: runId ?? null
      };
    });
  } catch (error) {
    if (error instanceof SwarmQuotaError) {
      if (error.reason === "worker_budget_exhausted") {
        await markWorkerPaused(current.nodeId, current.workflowAgentId);
      } else if (error.reason === "budget_exhausted" || error.reason === "deadline_reached") {
        await markNodePaused(current.nodeId, error.reason);
      }
    }
    throw error;
  }
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
    const debt = Math.max(0, settledTokens - requestedTokens);
    const quarantined = row.quota_generation !== row.node_generation
      || row.node_status === "cancelled"
      || row.node_status === "completed"
      || (row.deadline_at !== null && Date.parse(row.deadline_at) <= Date.now());
    if (quarantined) {
      if (row.deadline_at !== null && Date.parse(row.deadline_at) <= Date.now() && row.node_status === "active") {
        await client.query(
          `UPDATE task_workflow_swarm_nodes
              SET status = 'paused', paused_reason = 'deadline_reached', updated_at = now()
            WHERE id = $1`,
          [reservation.nodeId]
        );
      }
      await client.query(
        `UPDATE task_workflow_swarm_quota_reservations
            SET settled_tokens = $2, status = 'expired', settled_at = now()
          WHERE id = $1`,
        [reservation.reservationId, settledTokens]
      );
      await client.query(
        `UPDATE task_workflow_swarm_node_members
            SET reserved_tokens = GREATEST(0, reserved_tokens - $2), updated_at = now()
          WHERE node_id = $1 AND workflow_agent_id = $3`,
        [reservation.nodeId, requestedTokens, reservation.workflowAgentId]
      );
      await client.query(
        `UPDATE task_workflow_swarm_nodes
            SET reserved_tokens = GREATEST(0, reserved_tokens - $2),
                system_reserve_tokens = CASE WHEN $3 THEN system_reserve_tokens + $2 ELSE system_reserve_tokens END,
                updated_at = now()
          WHERE id = $1`,
        [reservation.nodeId, requestedTokens, row.recovery]
      );
      await client.query(
        `INSERT INTO task_workflow_swarm_quota_ledger
          (workflow_task_id, node_id, workflow_agent_id, run_id, kind, amount_tokens, metadata_json)
         VALUES ($1, $2, $3, $4, 'settlement', $5, $6::jsonb)`,
        [context.workflowTaskId, reservation.nodeId, reservation.workflowAgentId, reservation.runId, settledTokens, JSON.stringify({ requestedTokens, debt, quarantined: true, late: row.deadline_at !== null && Date.parse(row.deadline_at) <= Date.now() })]
      );
      return false;
    }
    await client.query(
      `UPDATE task_workflow_swarm_quota_reservations
          SET settled_tokens = $2, status = 'settled', settled_at = now()
        WHERE id = $1`,
      [reservation.reservationId, settledTokens]
    );
    await client.query(
      `UPDATE task_workflow_swarm_node_members
          SET reserved_tokens = GREATEST(0, reserved_tokens - $2),
              spent_tokens = spent_tokens + $3,
              updated_at = now()
        WHERE node_id = $1 AND workflow_agent_id = $4`,
      [reservation.nodeId, requestedTokens, settledTokens, reservation.workflowAgentId]
    );
    await client.query(
      `UPDATE task_workflow_swarm_nodes
          SET reserved_tokens = GREATEST(0, reserved_tokens - $2),
              spent_tokens = spent_tokens + $3,
              debt_tokens = debt_tokens + $4,
              system_reserve_tokens = CASE WHEN $5 THEN system_reserve_tokens + GREATEST(0, $2 - $3) ELSE system_reserve_tokens END,
              updated_at = now()
        WHERE id = $1`,
      [reservation.nodeId, requestedTokens, settledTokens, debt, row.recovery]
    );
    await client.query(
      `INSERT INTO task_workflow_swarm_quota_ledger
        (workflow_task_id, node_id, workflow_agent_id, run_id, kind, amount_tokens, metadata_json)
       VALUES ($1, $2, $3, $4, 'settlement', $5, $6::jsonb)`,
      [context.workflowTaskId, reservation.nodeId, reservation.workflowAgentId, reservation.runId, settledTokens, JSON.stringify({ requestedTokens, debt })]
    );
    return true;
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
    const requestedTokens = numberValue(row.requested_tokens);
    await client.query(
      `UPDATE task_workflow_swarm_quota_reservations
          SET status = 'released', settled_at = now()
        WHERE id = $1`,
      [reservation.reservationId]
    );
    await client.query(
      `UPDATE task_workflow_swarm_node_members
          SET reserved_tokens = GREATEST(0, reserved_tokens - $2), updated_at = now()
        WHERE node_id = $1 AND workflow_agent_id = $3`,
      [reservation.nodeId, requestedTokens, reservation.workflowAgentId]
    );
    await client.query(
      `UPDATE task_workflow_swarm_nodes
          SET reserved_tokens = GREATEST(0, reserved_tokens - $2),
              system_reserve_tokens = CASE WHEN $3 THEN system_reserve_tokens + $2 ELSE system_reserve_tokens END,
              updated_at = now()
        WHERE id = $1`,
      [reservation.nodeId, requestedTokens, row.recovery]
    );
  });
}

export async function wakeParentForSwarmQuota(input: {
  context: LoadedWorkflowRunContext;
  triggerSource: TaskExecutionJob["triggerSource"];
  selectionUserId: string | null;
  reason: string;
}): Promise<void> {
  const current = await loadCurrentNode(input.context, true);
  const wakeTaskId = current.role === "worker" ? current.nodeLeaderTaskId : current.parentLeaderTaskId;
  if (!wakeTaskId) return;
  const subject = current.role === "worker" ? `Worker ${input.context.taskId}` : `Child Swarm node ${current.nodeId}`;
  const posted = await postSwarmQuotaNotice(input.context, {
    nodeId: current.nodeId,
    senderWorkflowAgentId: current.workflowAgentId,
    notifyParentNode: current.role === "leader",
    message: `[Swarm budget event] ${subject}: ${input.reason} Check swarm_budget_status, then grant enough budget, cancel the child, or synthesize available work.`
  });
  if (!posted) return;
  await wakePausedSwarmAgent(input.context, wakeTaskId, `Swarm leader resumed for a budget event: ${subject}.`);
}

// The notice goes through the swarm channel shared with the leader being woken, never into that
// leader's task history: an out-of-band task message starts a detached branch that drops its context.
async function postSwarmQuotaNotice(context: LoadedWorkflowRunContext, input: {
  nodeId: string;
  senderWorkflowAgentId: string;
  notifyParentNode: boolean;
  message: string;
}): Promise<boolean> {
  return withTransaction(async (client) => {
    const workflow = await client.query<{ phase: string | null; config_json: Record<string, unknown> | null }>(
      `SELECT phase, config_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (!workflow.rows[0] || workflow.rows[0].phase === "completed") return false;
    const node = await client.query<{ node_key: string; parent_node_key: string | null }>(
      `SELECT n.node_key, parent_node.node_key AS parent_node_key
         FROM task_workflow_swarm_nodes n
         LEFT JOIN task_workflow_swarm_nodes parent_node ON parent_node.id = n.parent_node_id
        WHERE n.id = $1`,
      [input.nodeId]
    );
    const channelKey = input.notifyParentNode ? node.rows[0]?.parent_node_key : node.rows[0]?.node_key;
    const channelIds = workflow.rows[0].config_json?.swarmChannelIds;
    const channelId = channelKey && channelIds && typeof channelIds === "object"
      ? (channelIds as Record<string, unknown>)[channelKey]
      : null;
    if (typeof channelId !== "string") return false;
    await client.query(
      `INSERT INTO task_workflow_messages (workflow_task_id, channel_id, sender_workflow_agent_id, content_markdown)
       VALUES ($1, $2, $3, $4)`,
      [context.workflowTaskId, channelId, input.senderWorkflowAgentId, input.message]
    );
    return true;
  });
}

export async function getSwarmBudgetStatus(
  context: LoadedWorkflowRunContext,
  targetSwarm?: SwarmTarget
): Promise<SwarmBudgetStatus> {
  const target = resolveSwarmTarget(context, targetSwarm);
  const legacyStatus: SwarmBudgetStatus = {
    status: "legacy",
    remainingTokens: 0,
    unassignedTokens: 0,
    deadlineAt: null,
    minimumSpawnAllocationTokens: AGENT_SWARM_MINIMUM_CHILD_NODE_TOKENS,
    workers: [],
    children: []
  };
  if (!target.nodeId) return legacyStatus;

  const nodeResult = await query<{
    id: string;
    status: string;
    unassigned_tokens: string | number;
    deadline_at: string | null;
  }>(
    `SELECT id, status, unassigned_tokens, deadline_at
       FROM task_workflow_swarm_nodes
      WHERE node_key = $1
        AND workflow_task_id = $2`,
    [target.nodeId, context.workflowTaskId]
  );
  const node = nodeResult.rows[0];
  if (!node) return legacyStatus;

  const workersResult = await query<{
    task_id: string;
    status: string;
    lease_tokens: string | number;
    spent_tokens: string | number;
    reserved_tokens: string | number;
  }>(
    `SELECT agent.task_id, member.status, member.lease_tokens, member.spent_tokens, member.reserved_tokens
       FROM task_workflow_swarm_node_members member
       JOIN task_workflow_agents agent ON agent.id = member.workflow_agent_id
      WHERE member.node_id = $1 AND member.role = 'worker'
      ORDER BY member.slot_index`,
    [node.id]
  );
  const leaseRemainingResult = await query<{ remaining_tokens: string | number | null }>(
    `SELECT COALESCE(SUM(GREATEST(0, lease_tokens - spent_tokens - reserved_tokens)), 0) AS remaining_tokens
       FROM task_workflow_swarm_node_members
      WHERE node_id = $1 AND status = 'active'`,
    [node.id]
  );
  const latestUsageResult = await query<{ weighted_tokens: string | number | null }>(
    `SELECT weighted_tokens
       FROM user_token_usage_events
      WHERE task_id = ANY($1::uuid[])
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT 1`,
    [target.memberTaskIds]
  );
  const minimumStepTokens = Math.max(AGENT_SWARM_MINIMUM_INFERENCE_TOKENS, numberValue(latestUsageResult.rows[0]?.weighted_tokens));
  const unassignedTokens = numberValue(node.unassigned_tokens);

  return {
    status: node.status,
    remainingTokens: unassignedTokens + numberValue(leaseRemainingResult.rows[0]?.remaining_tokens),
    unassignedTokens,
    deadlineAt: node.deadline_at,
    minimumSpawnAllocationTokens: AGENT_SWARM_MINIMUM_CHILD_NODE_TOKENS,
    workers: workersResult.rows.map((worker) => ({
      taskId: worker.task_id,
      status: worker.status,
      remainingTokens: Math.max(0, numberValue(worker.lease_tokens) - numberValue(worker.spent_tokens) - numberValue(worker.reserved_tokens))
    })),
    children: await loadSwarmBudgetChildren(node.id, minimumStepTokens)
  };
}

async function loadSwarmBudgetChildren(nodeId: string, minimumStepTokens: number): Promise<SwarmBudgetChildStatus[]> {
  const childrenResult = await query<{
    id: string;
    title: string;
    status: string;
    allocated_tokens: string | number;
    unassigned_tokens: string | number;
    deadline_at: string | null;
    worker_slots: string | number;
    lease_remaining_tokens: string | number;
  }>(
    `SELECT id, title, status, allocated_tokens, unassigned_tokens, deadline_at,
            (SELECT COUNT(*) FROM task_workflow_swarm_node_members member
              WHERE member.node_id = task_workflow_swarm_nodes.id AND member.role = 'worker') AS worker_slots,
            (SELECT COALESCE(SUM(GREATEST(0, member.lease_tokens - member.spent_tokens - member.reserved_tokens)), 0)
               FROM task_workflow_swarm_node_members member
              WHERE member.node_id = task_workflow_swarm_nodes.id AND member.status = 'active') AS lease_remaining_tokens
       FROM task_workflow_swarm_nodes
      WHERE parent_node_id = $1
      ORDER BY created_at ASC, id ASC`,
    [nodeId]
  );
  return childrenResult.rows.map((child) => ({
    nodeId: child.id,
    title: child.title,
    status: child.status,
    remainingTokens: numberValue(child.unassigned_tokens) + numberValue(child.lease_remaining_tokens),
    deadlineAt: child.deadline_at,
    minimumGrantTokens: calculateAgentSwarmMinimumGrant({
      allocatedTokens: numberValue(child.allocated_tokens),
      minimumStepTokens,
      workerSlots: numberValue(child.worker_slots),
      spawning: false
    })
  }));
}
