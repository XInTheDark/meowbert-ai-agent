import fs from "node:fs/promises";
import { query } from "../../lib/db.js";
import { resolveTaskDir } from "../tasks/task-paths.js";
import type { SwarmChannelSummary, LoadedWorkflowRunContext } from "./context-types.js";
import { resolveSwarmSharedDir } from "./paths.js";
import {
  asObject,
  clampNonNegativeInteger,
  coerceNullableString,
  formatSwarmAgentLabel,
  getLatestWorkflowMessageNo,
  isSwarmTaskActiveStatus,
  type WorkflowAgentRecord
} from "./shared.js";

export async function loadSwarmChannels(
  workflowTaskId: string,
  currentWorkflowAgentId: string | null
): Promise<SwarmChannelSummary[]> {
  const channelsRes = await query<{
    id: string;
    kind: "global" | "direct" | "group";
    title: string | null;
    created_at: string;
    latest_message_no: number | null;
    unread_count: number | null;
    member_task_ids: string[];
  }>(
    `SELECT c.id,
            c.kind,
            c.title,
            c.created_at,
            COALESCE(MAX(m.message_no), 0)::int AS latest_message_no,
            COALESCE(
              SUM(
                CASE
                  WHEN $2::uuid IS NOT NULL
                   AND cm.workflow_agent_id = $2::uuid
                   AND m.message_no > cm.last_seen_message_no
                  THEN 1
                  ELSE 0
                END
              ),
              0
            )::int AS unread_count,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT member_agent.task_id), NULL) AS member_task_ids
       FROM task_workflow_channels c
       JOIN task_workflow_channel_members cm_current
         ON cm_current.channel_id = c.id
      LEFT JOIN task_workflow_messages m
         ON m.channel_id = c.id
      LEFT JOIN task_workflow_channel_members cm
         ON cm.channel_id = c.id
      LEFT JOIN task_workflow_agents member_agent
         ON member_agent.id = cm.workflow_agent_id
      WHERE c.workflow_task_id = $1
        AND ($2::uuid IS NULL OR cm_current.workflow_agent_id = $2::uuid)
      GROUP BY c.id, c.kind, c.title, c.created_at
      ORDER BY c.created_at ASC, c.id ASC`,
    [workflowTaskId, currentWorkflowAgentId]
  );

  return channelsRes.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    created_at: row.created_at,
    latest_message_no: clampNonNegativeInteger(row.latest_message_no),
    unread_count: clampNonNegativeInteger(row.unread_count),
    member_task_ids: row.member_task_ids ?? []
  }));
}

async function loadSwarmMessageStats(input: {
  workflowTaskId: string;
  cycleStartMessageNo: number;
  leaderKickoffMessageNo: number | null;
}): Promise<{
  cycleStartMessageNo: number;
  leaderKickoffMessageNo: number | null;
  globalChannelId: string | null;
  latestWorkflowMessageNo: number;
  leaderGlobalMessageCount: number;
  globalMessageCountByTaskId: Map<string, number>;
}> {
  const latestWorkflowMessageNo = await getLatestWorkflowMessageNo(input.workflowTaskId);
  const swarmMessageStatsRes = await query<{
    sender_task_id: string | null;
    sender_role: WorkflowAgentRecord["role"] | null;
    global_message_count_since_cycle_start: number;
    global_message_count_since_leader_kickoff: number;
  }>(
    `SELECT sender.task_id AS sender_task_id,
            sender.role AS sender_role,
            COUNT(*) FILTER (
              WHERE c.kind = 'global'
                AND m.message_no > $2::bigint
            )::int AS global_message_count_since_cycle_start,
            COUNT(*) FILTER (
              WHERE c.kind = 'global'
                AND $3::bigint IS NOT NULL
                AND m.message_no > $3::bigint
            )::int AS global_message_count_since_leader_kickoff
       FROM task_workflow_messages m
       JOIN task_workflow_channels c
         ON c.id = m.channel_id
       LEFT JOIN task_workflow_agents sender
         ON sender.id = m.sender_workflow_agent_id
      WHERE m.workflow_task_id = $1
      GROUP BY sender.task_id, sender.role`,
    [input.workflowTaskId, input.cycleStartMessageNo, input.leaderKickoffMessageNo]
  );
  const globalChannelId = (await query<{ id: string }>(
    `SELECT id
       FROM task_workflow_channels
      WHERE workflow_task_id = $1
        AND kind = 'global'
      ORDER BY created_at ASC
      LIMIT 1`,
    [input.workflowTaskId]
  )).rows[0]?.id ?? null;

  const globalMessageCountByTaskId = new Map<string, number>();
  let leaderGlobalMessageCount = 0;
  for (const row of swarmMessageStatsRes.rows) {
    if (row.sender_task_id) {
      globalMessageCountByTaskId.set(
        row.sender_task_id,
        clampNonNegativeInteger(row.global_message_count_since_leader_kickoff)
      );
    }
    if (row.sender_role === "leader") {
      leaderGlobalMessageCount += clampNonNegativeInteger(row.global_message_count_since_cycle_start);
    }
  }

  return {
    cycleStartMessageNo: input.cycleStartMessageNo,
    leaderKickoffMessageNo: input.leaderKickoffMessageNo,
    globalChannelId,
    latestWorkflowMessageNo,
    leaderGlobalMessageCount,
    globalMessageCountByTaskId
  };
}

function buildWorkerReportState(workerAgents: WorkflowAgentRecord[], globalMessageCountByTaskId: Map<string, number>) {
  const workerGlobalReportTaskIds = workerAgents
    .filter((agent) => (globalMessageCountByTaskId.get(agent.task_id) ?? 0) > 0)
    .map((agent) => agent.task_id);
  const missingWorkerGlobalReportTaskIds = workerAgents
    .filter((agent) => (globalMessageCountByTaskId.get(agent.task_id) ?? 0) === 0)
    .map((agent) => agent.task_id);

  return {
    workerGlobalReportTaskIds,
    workerGlobalReportLabels: workerAgents
      .filter((agent) => workerGlobalReportTaskIds.includes(agent.task_id))
      .map((agent) => formatSwarmAgentLabel(agent.role, agent.slot_index, agent.title)),
    missingWorkerGlobalReportTaskIds,
    missingWorkerGlobalReportLabels: workerAgents
      .filter((agent) => missingWorkerGlobalReportTaskIds.includes(agent.task_id))
      .map((agent) => formatSwarmAgentLabel(agent.role, agent.slot_index, agent.title))
  };
}

function readFinalReview(stateJson: Record<string, unknown>) {
  const review = stateJson.finalReview;
  if (!review || typeof review !== "object" || Array.isArray(review)) return null;
  const record = review as Record<string, unknown>;
  const reviewerTaskId = coerceNullableString(record.reviewerTaskId);
  const reviewerLabel = coerceNullableString(record.reviewerLabel);
  const summary = coerceNullableString(record.summary);
  if (!reviewerTaskId || !reviewerLabel || !summary || typeof record.approved !== "boolean") return null;
  return { reviewerTaskId, reviewerLabel, approved: record.approved, summary };
}

export async function buildSwarmContext(input: {
  workflowTaskId: string;
  taskId: string;
  envRoot: string;
  currentAgentId: string | null;
  agents: WorkflowAgentRecord[];
  configJson: Record<string, unknown>;
  stateJson: Record<string, unknown>;
}): Promise<LoadedWorkflowRunContext["swarm"]> {
  const sharedDir = resolveSwarmSharedDir(input.envRoot, input.workflowTaskId);
  await fs.mkdir(sharedDir, { recursive: true });

  const cycleStartMessageNo = clampNonNegativeInteger(input.stateJson.cycleStartMessageNo, 0);
  const rawLeaderKickoffMessageNo = input.stateJson.leaderKickoffMessageNo;
  const leaderKickoffMessageNo =
    typeof rawLeaderKickoffMessageNo === "number" && Number.isFinite(rawLeaderKickoffMessageNo)
      ? clampNonNegativeInteger(rawLeaderKickoffMessageNo, 0)
      : null;

  const { globalChannelId, latestWorkflowMessageNo, leaderGlobalMessageCount, globalMessageCountByTaskId } =
    await loadSwarmMessageStats({
      workflowTaskId: input.workflowTaskId,
      cycleStartMessageNo,
      leaderKickoffMessageNo
    });
  const workerAgents = input.agents.filter((agent) => agent.role === "worker");
  const startedTaskIds = Array.isArray(input.stateJson.startedSwarmWorkerTaskIds)
    ? new Set(input.stateJson.startedSwarmWorkerTaskIds.filter((id): id is string => typeof id === "string"))
    : input.stateJson.workersStartedAt
      ? new Set(workerAgents.map((agent) => agent.task_id))
      : new Set<string>();
  const startedWorkerAgents = workerAgents.filter((agent) => startedTaskIds.has(agent.task_id));
  const compiledSwarm = asObject(input.configJson.compiledSwarm);
  const rootNodeId = typeof compiledSwarm.rootNodeId === "string" ? compiledSwarm.rootNodeId : null;
  const nodes = Array.isArray(compiledSwarm.nodes) ? compiledSwarm.nodes.map(asObject) : [];
  const taskIdByLeafId = new Map(input.agents.flatMap((agent) => {
    const leafId = agent.state_json?.swarmLeafId;
    return typeof leafId === "string" ? [[leafId, agent.task_id] as const] : [];
  }));
  const completedNodes = asObject(input.stateJson.completedSwarmNodeIds);
  const pendingNestedSwarmNodeIds = nodes
    .filter((node) => typeof node.parentNodeId === "string" && typeof node.id === "string")
    .filter((node) => {
      const leaderTaskId = taskIdByLeafId.get(node.leaderLeafId as string);
      return leaderTaskId
        && (leaderTaskId === input.workflowTaskId || startedTaskIds.has(leaderTaskId))
        && !completedNodes[node.id as string];
    })
    .map((node) => node.id as string);
  const rootNode = nodes.find((node) => node.id === rootNodeId);
  const rootWorkerTaskIds = Array.isArray(rootNode?.workerLeafIds)
    ? new Set(rootNode.workerLeafIds.flatMap((leafId) => typeof leafId === "string"
      ? [taskIdByLeafId.get(leafId)].filter((taskId): taskId is string => Boolean(taskId)) : []))
    : null;
  const rootWorkerAgents = rootWorkerTaskIds
    ? startedWorkerAgents.filter((agent) => rootWorkerTaskIds.has(agent.task_id))
    : rootNodeId
      ? startedWorkerAgents.filter((agent) => agent.state_json.swarmParentNodeId === rootNodeId)
      : startedWorkerAgents;
  const workerReportState = buildWorkerReportState(rootWorkerAgents, globalMessageCountByTaskId);

  return {
    sharedDir,
    channels: await loadSwarmChannels(input.workflowTaskId, input.currentAgentId),
    peerTaskDirs: input.agents
      .filter((agent) => agent.task_id !== input.taskId)
      .map((agent) => ({
        taskId: agent.task_id,
        title: agent.title,
        role: agent.role,
        slotIndex: agent.slot_index,
        taskDir: resolveTaskDir(input.envRoot, agent.task_root_path)
      })),
    globalChannelId,
    latestWorkflowMessageNo,
    leaderGlobalMessageCount,
    activeWorkerCount: startedWorkerAgents.filter((agent) => isSwarmTaskActiveStatus(agent.status)).length,
    workerGlobalReportTaskIds: workerReportState.workerGlobalReportTaskIds,
    workerGlobalReportLabels: workerReportState.workerGlobalReportLabels,
    missingWorkerGlobalReportTaskIds: workerReportState.missingWorkerGlobalReportTaskIds,
    missingWorkerGlobalReportLabels: workerReportState.missingWorkerGlobalReportLabels,
    workersStartedAt: coerceNullableString(input.stateJson.workersStartedAt) ?? null,
    lastWaitCycleTaskIds: Array.isArray(input.stateJson.lastSwarmWaitCycleTaskIds)
      ? input.stateJson.lastSwarmWaitCycleTaskIds.filter((id): id is string => typeof id === "string")
      : [],
    completedReviewRounds: Array.isArray(input.stateJson.reviewRounds) ? input.stateJson.reviewRounds.length : 0,
    pendingNestedSwarmNodeIds,
    finalReview: readFinalReview(input.stateJson)
  };
}
