import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import { isTaskRunLatestAttempt } from "../agent-db/index.js";
import { channelsForSwarmTarget, resolveSwarmChannelForAgent } from "./agent-swarm-channel-access.js";
import { hasDualSwarmRole, resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";
import {
  type SwarmChannelSummary,
  type SwarmInboxRefreshResult,
  type LoadedWorkflowRunContext,
  loadSwarmChannels
} from "./context.js";
import {
  asObject,
  SWARM_INBOX_CHAR_BUDGET,
  SWARM_READ_CHANNEL_MESSAGE_LIMIT,
  coerceNullableString,
  estimateTextCost,
  formatSwarmAgentLabel,
  getLatestWorkflowMessageNo,
  type WorkflowAgentRole,
  type WorkflowMessageRecord
} from "./shared.js";
import { cancelPendingWorkflowRuns } from "./agent-swarm-runs.js";
import { markSwarmAgentFinished, maybeWakePausedSwarmAgentsAfterMessage } from "./agent-swarm-mailbox.js";

function groupSwarmUnreadMessages(rows: WorkflowMessageRecord[]): Map<string, WorkflowMessageRecord[]> {
  const grouped = new Map<string, WorkflowMessageRecord[]>();
  for (const row of rows) {
    const existing = grouped.get(row.channel_id) ?? [];
    existing.push(row);
    grouped.set(row.channel_id, existing);
  }
  return grouped;
}

async function buildSwarmInboxBundle(context: LoadedWorkflowRunContext, targetSwarm?: SwarmTarget): Promise<SwarmInboxRefreshResult> {
  if (context.workflowType !== "agent_swarm") {
    throw new Error("Swarm inbox is only available for agent_swarm workflows.");
  }
  if (!context.currentAgent) {
    throw new Error("Current workflow agent could not be resolved.");
  }

  const messageRowsRes = await query<WorkflowMessageRecord>(
    `SELECT m.id,
            m.channel_id,
            c.title AS channel_title,
            c.kind AS channel_kind,
            m.message_no,
            m.content_markdown,
            m.created_at,
            sender.task_id AS sender_task_id,
            sender.role AS sender_role,
            sender.slot_index AS sender_slot_index,
            sender_task.title AS sender_title
       FROM task_workflow_channel_members cm
       JOIN task_workflow_channels c
         ON c.id = cm.channel_id
       JOIN task_workflow_messages m
         ON m.channel_id = c.id
        AND m.message_no > cm.last_seen_message_no
       LEFT JOIN task_workflow_agents sender
         ON sender.id = m.sender_workflow_agent_id
       LEFT JOIN tasks sender_task
         ON sender_task.id = sender.task_id
      WHERE cm.workflow_agent_id = $1
      ORDER BY m.message_no ASC`,
    [context.currentAgent.id]
  );

  const grouped = groupSwarmUnreadMessages(messageRowsRes.rows);

  const latestWorkflowMessageNo = await getLatestWorkflowMessageNo(context.workflowTaskId);
  const perChannelSummaries: SwarmInboxRefreshResult["channels"] = [];
  const sections: string[] = [];
  let totalUnread = 0;
  let usedChars = 0;

  const channels = targetSwarm
    ? channelsForSwarmTarget(context, context.swarm?.channels ?? [], targetSwarm)
    : context.swarm?.channels ?? [];
  for (const channel of channels) {
    const unreadRows = grouped.get(channel.id) ?? [];
    if (unreadRows.length === 0) {
      continue;
    }

    totalUnread += unreadRows.length;
    const channelHeader = `### ${channel.title ?? channel.kind} (${channel.kind})`;
    const channelHeaderCost = estimateTextCost(channelHeader) + 2;
    const budgetRemaining = Math.max(0, SWARM_INBOX_CHAR_BUDGET - usedChars - channelHeaderCost);
    const deliveredLines: string[] = [];
    let deliveredCount = 0;

    for (let index = unreadRows.length - 1; index >= 0; index -= 1) {
      const row = unreadRows[index];
      const senderLabel = row.sender_role === "leader"
        ? "Leader"
        : formatSwarmAgentLabel(row.sender_role, row.sender_slot_index, row.sender_title ?? row.sender_task_id);
      const line = `- #${row.message_no} · ${senderLabel} · ${row.created_at}\n${row.content_markdown.trim()}`;
      const nextCost = deliveredLines.length === 0
        ? estimateTextCost(line)
        : estimateTextCost(line) + 2;
      if (nextCost > budgetRemaining - estimateTextCost(deliveredLines.join("\n\n"))) {
        break;
      }
      deliveredLines.unshift(line);
      deliveredCount += 1;
    }

    const overflowCount = unreadRows.length - deliveredCount;
    const sectionLines = [channelHeader];
    if (overflowCount > 0) {
      const omittedPreview = unreadRows
        .slice(0, overflowCount)
        .map((row) => row.sender_role === "leader"
          ? "Leader"
          : formatSwarmAgentLabel(row.sender_role, row.sender_slot_index, row.sender_title))
        .slice(0, 4);
      sectionLines.push(`- Older unread messages summarized: ${overflowCount} omitted (${Array.from(new Set(omittedPreview)).join(", ") || "various senders"}).`);
    }
    if (deliveredLines.length === 0) {
      sectionLines.push("- No message bodies could fit inside the inbox budget.");
    } else {
      sectionLines.push(...deliveredLines);
    }

    const sectionText = sectionLines.join("\n");
    usedChars += estimateTextCost(sectionText) + 2;
    sections.push(sectionText);
    perChannelSummaries.push({
      channelId: channel.id,
      title: channel.title,
      kind: channel.kind,
      unreadCount: unreadRows.length,
      deliveredCount,
      overflowCount,
      latestMessageNo: unreadRows[unreadRows.length - 1]?.message_no ?? channel.latest_message_no
    });
  }

  const bundleText = totalUnread === 0
    ? "No unread swarm messages."
    : [
      "## Swarm Inbox Delta",
      "",
      `Unread messages delivered: ${totalUnread}.`,
      sections.join("\n\n")
    ].join("\n");

  return {
    delivered: totalUnread > 0,
    latestWorkflowMessageNo,
    unreadMessageCount: totalUnread,
    bundleText,
    channels: perChannelSummaries
  };
}

async function markSwarmInboxSeen(context: LoadedWorkflowRunContext, refresh: SwarmInboxRefreshResult): Promise<void> {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) {
    return;
  }
  const currentAgentId = context.currentAgent.id;

  await withTransaction(async (client) => {
    for (const channel of refresh.channels) {
      await client.query(
        `UPDATE task_workflow_channel_members
            SET last_seen_message_no = GREATEST(last_seen_message_no, $3),
                updated_at = now()
          WHERE channel_id = $1
            AND workflow_agent_id = $2`,
        [channel.channelId, currentAgentId, channel.latestMessageNo]
      );
    }

    await client.query(
      `UPDATE task_workflow_agents
          SET last_inbox_refresh_message_no = GREATEST(last_inbox_refresh_message_no, $2),
              updated_at = now()
        WHERE id = $1`,
      [currentAgentId, refresh.latestWorkflowMessageNo]
    );
  });

  if (context.swarm) {
    context.swarm.channels = await loadSwarmChannels(context.workflowTaskId, currentAgentId);
    context.swarm.latestWorkflowMessageNo = refresh.latestWorkflowMessageNo;
  }
}

function updateInMemorySwarmStateAfterGlobalMessage(
  context: LoadedWorkflowRunContext,
  messageNo: number
): void {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent || !context.swarm) {
    return;
  }

  context.swarm.latestWorkflowMessageNo = Math.max(context.swarm.latestWorkflowMessageNo, messageNo);

  if (context.currentAgent.role === "leader") {
    context.swarm.leaderGlobalMessageCount += 1;
    return;
  }

  if (context.currentAgent.role !== "worker") {
    return;
  }

  const taskId = context.currentAgent.task_id;
  if (!context.swarm.workerGlobalReportTaskIds.includes(taskId)) {
    context.swarm.workerGlobalReportTaskIds.push(taskId);
  }

  const workerLabel = formatSwarmAgentLabel(
    context.currentAgent.role,
    context.currentAgent.slot_index,
    context.currentAgent.title ?? taskId
  );
  if (!context.swarm.workerGlobalReportLabels.includes(workerLabel)) {
    context.swarm.workerGlobalReportLabels.push(workerLabel);
  }

  context.swarm.missingWorkerGlobalReportTaskIds = context.swarm.missingWorkerGlobalReportTaskIds
    .filter((missingTaskId) => missingTaskId !== taskId);
  context.swarm.missingWorkerGlobalReportLabels = context.swarm.missingWorkerGlobalReportLabels
    .filter((label) => label !== workerLabel);
}

async function persistLeaderKickoffMessageNo(
  client: PoolClient,
  context: LoadedWorkflowRunContext,
  channelId: string,
  messageNo: number
): Promise<void> {
  if (
    context.currentAgent?.role !== "leader"
    || context.swarm?.globalChannelId !== channelId
  ) {
    return;
  }

  const workflowResult = await client.query<{ state_json: Record<string, unknown> | null }>(
    `SELECT state_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
    [context.workflowTaskId]
  );
  const currentState = asObject(workflowResult.rows[0]?.state_json);
  if (typeof currentState.leaderKickoffMessageNo === "number" && currentState.leaderKickoffMessageNo > 0) {
    return;
  }

  await client.query(
    `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
    [context.workflowTaskId, JSON.stringify({ ...currentState, leaderKickoffMessageNo: messageNo })]
  );
}

async function refreshSwarmInbox(
  context: LoadedWorkflowRunContext,
  targetSwarm?: SwarmTarget
): Promise<SwarmInboxRefreshResult> {
  const refresh = await buildSwarmInboxBundle(context, targetSwarm);
  await markSwarmInboxSeen(context, refresh);
  return refresh;
}

// Delivered between turns, so agents never need to poll for mail.
export async function deliverSwarmInbox(context: LoadedWorkflowRunContext | null): Promise<SwarmInboxRefreshResult | null> {
  if (!context || context.workflowType !== "agent_swarm") {
    return null;
  }
  return refreshSwarmInbox(context);
}

// Mail that arrived during the current turn has not been seen yet. Hand it over instead of sending,
// so the agent never posts over messages it has not read.
async function assertNoUnreadSwarmMail(context: LoadedWorkflowRunContext, targetSwarm?: SwarmTarget): Promise<void> {
  const refresh = await refreshSwarmInbox(context, targetSwarm);
  if (!refresh.delivered) return;
  throw new Error([
    "New swarm messages arrived before this one was sent. Read them, then resend if your message still applies.",
    "",
    refresh.bundleText
  ].join("\n"));
}

export async function listSwarmChannelsForAgent(context: LoadedWorkflowRunContext, targetSwarm?: SwarmTarget): Promise<SwarmChannelSummary[]> {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) {
    throw new Error("Channel listing is only available for swarm agents.");
  }

  const channels = await loadSwarmChannels(context.workflowTaskId, context.currentAgent.id);
  if (context.swarm) {
    context.swarm.channels = channels;
  }
  return channelsForSwarmTarget(context, channels, targetSwarm);
}

export async function readSwarmChannel(context: LoadedWorkflowRunContext, input: {
  targetSwarm?: SwarmTarget;
  channelId: string;
  sinceMessageNo?: number | null;
}): Promise<{
  channelId: string;
  messages: Array<{
    id: string;
    messageNo: number;
    createdAt: string;
    senderTaskId: string | null;
    senderRole: WorkflowAgentRole | null;
    senderSlotIndex: number | null;
    contentMarkdown: string;
  }>;
}> {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) {
    throw new Error("Channel reading is only available for swarm agents.");
  }
  const resolvedChannel = await resolveSwarmChannelForAgent(context, input.channelId, input.targetSwarm);

  const rowsRes = await query<{
    id: string;
    message_no: number;
    created_at: string;
    sender_task_id: string | null;
    sender_role: WorkflowAgentRole | null;
    sender_slot_index: number | null;
    content_markdown: string;
  }>(
    `SELECT m.id,
            m.message_no,
            m.created_at,
            sender.task_id AS sender_task_id,
            sender.role AS sender_role,
            sender.slot_index AS sender_slot_index,
            m.content_markdown
       FROM task_workflow_messages m
       LEFT JOIN task_workflow_agents sender
         ON sender.id = m.sender_workflow_agent_id
      WHERE m.workflow_task_id = $1
        AND m.channel_id = $2
        AND ($3::bigint IS NULL OR m.message_no > $3)
      ORDER BY m.message_no ASC
      LIMIT ${SWARM_READ_CHANNEL_MESSAGE_LIMIT}`,
    [context.workflowTaskId, resolvedChannel.id, input.sinceMessageNo ?? null]
  );

  return {
    channelId: resolvedChannel.id,
    messages: rowsRes.rows.map((row) => ({
      id: row.id,
      messageNo: row.message_no,
      createdAt: row.created_at,
      senderTaskId: row.sender_task_id,
      senderRole: row.sender_role,
      senderSlotIndex: row.sender_slot_index,
      contentMarkdown: row.content_markdown
    }))
  };
}

export async function createSwarmChannelForAgent(context: LoadedWorkflowRunContext, input: {
  targetSwarm?: SwarmTarget;
  memberAgentTaskIds: string[];
  title?: string | null;
}): Promise<{ channelId: string; kind: "direct" | "group"; title: string | null; memberTaskIds: string[] }> {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) {
    throw new Error("Channel creation is only available for swarm agents.");
  }

  const target = resolveSwarmTarget(context, input.targetSwarm);
  const allTaskIds = Array.from(new Set([context.currentAgent.task_id, ...input.memberAgentTaskIds]));
  if (hasDualSwarmRole(context) && allTaskIds.some((taskId) => !target.memberTaskIds.includes(taskId))) {
    throw new Error("Channel members must belong to the selected swarm.");
  }
  const memberAgents = context.agents.filter((agent) => allTaskIds.includes(agent.task_id));
  if (memberAgents.length < 2) {
    throw new Error("A swarm channel must include at least two swarm agents.");
  }

  const kind: "direct" | "group" = memberAgents.length === 2 ? "direct" : "group";
  const title = coerceNullableString(input.title) ?? null;

  const inserted = await query<{ id: string }>(
    `INSERT INTO task_workflow_channels (
      workflow_task_id,
      kind,
      title,
      created_by_workflow_agent_id
    ) VALUES ($1, $2, $3, $4)
    RETURNING id`,
    [context.workflowTaskId, kind, title, context.currentAgent.id]
  );
  const channelId = inserted.rows[0].id;

  for (const memberAgent of memberAgents) {
    await query(
      `INSERT INTO task_workflow_channel_members (
        channel_id,
        workflow_agent_id
      ) VALUES ($1, $2)`,
      [channelId, memberAgent.id]
    );
  }

  if (context.swarm) {
    context.swarm.channels = await loadSwarmChannels(context.workflowTaskId, context.currentAgent.id);
  }

  return {
    channelId,
    kind,
    title,
    memberTaskIds: memberAgents.map((agent) => agent.task_id)
  };
}

export async function sendSwarmChannelMessage(context: LoadedWorkflowRunContext, input: {
  targetSwarm?: SwarmTarget;
  channelId: string;
  message: string;
}): Promise<{ messageNo: number; createdAt: string }> {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) {
    throw new Error("Channel messaging is only available for swarm agents.");
  }

  const resolvedChannel = await resolveSwarmChannelForAgent(context, input.channelId, input.targetSwarm);
  await assertNoUnreadSwarmMail(context, input.targetSwarm);

  const inserted = await withTransaction(async (client) => {
    const workflowResult = await client.query<{ phase: string | null }>(
      `SELECT phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") {
      throw new Error("The Agent Swarm workflow is already completed.");
    }
    const messageResult = await client.query<{ message_no: number; created_at: string }>(
      `INSERT INTO task_workflow_messages (
        workflow_task_id,
        channel_id,
        sender_workflow_agent_id,
        content_markdown
      ) VALUES ($1, $2, $3, $4)
      RETURNING message_no, created_at`,
      [context.workflowTaskId, resolvedChannel.id, context.currentAgent!.id, input.message]
    );
    const messageNo = messageResult.rows[0].message_no;
    await client.query(
      `UPDATE task_workflow_channel_members
          SET last_seen_message_no = GREATEST(last_seen_message_no, $3),
              updated_at = now()
        WHERE channel_id = $1
          AND workflow_agent_id = $2`,
      [resolvedChannel.id, context.currentAgent!.id, messageNo]
    );
    await client.query(
      `UPDATE task_workflow_agents
          SET last_inbox_refresh_message_no = GREATEST(last_inbox_refresh_message_no, $2),
              updated_at = now()
        WHERE id = $1`,
      [context.currentAgent!.id, messageNo]
    );
    await persistLeaderKickoffMessageNo(client, context, resolvedChannel.id, messageNo);
    return messageResult.rows[0];
  });

  const messageNo = inserted.message_no;

  if (context.swarm) {
    context.swarm.channels = await loadSwarmChannels(context.workflowTaskId, context.currentAgent.id);
    context.swarm.latestWorkflowMessageNo = messageNo;
  }
  if (context.swarm?.globalChannelId === resolvedChannel.id) {
    updateInMemorySwarmStateAfterGlobalMessage(context, messageNo);
  }
  await maybeWakePausedSwarmAgentsAfterMessage(context, {
    channelId: resolvedChannel.id,
    channelMemberTaskIds: resolvedChannel.member_task_ids,
    senderTaskId: context.currentAgent.task_id,
    messageNo
  });

  return {
    messageNo,
    createdAt: inserted.created_at
  };
}

function resolveNestedSwarmOutputTarget(context: LoadedWorkflowRunContext, targetSwarm?: SwarmTarget): { nodeId: string; parentNodeId: string; channelId: string } {
  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  const channelIds = asObject(context.config.swarmChannelIds);
  const selected = resolveSwarmTarget(context, targetSwarm);
  const node = selected.isLeader ? nodes.find((candidate) => candidate.id === selected.nodeId) : null;
  const nodeId = typeof node?.id === "string" ? node.id : null;
  const parentNodeId = typeof node?.parentNodeId === "string" ? node.parentNodeId : null;
  const channelId = parentNodeId ? channelIds[parentNodeId] : null;
  if (!nodeId || !parentNodeId || typeof channelId !== "string") {
    throw new Error("submit_swarm_output is only available to a nested swarm leader.");
  }
  return { nodeId, parentNodeId, channelId };
}

export async function submitSwarmOutput(context: LoadedWorkflowRunContext, response: string, targetSwarm?: SwarmTarget): Promise<{ messageNo: number }> {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) {
    throw new Error("Swarm output is only available to swarm agents.");
  }
  const currentAgent = context.currentAgent;
  const trimmed = response.trim();
  if (!trimmed) {
    throw new Error("Swarm output must not be empty.");
  }
  const target = resolveNestedSwarmOutputTarget(context, targetSwarm);
  const inserted = await withTransaction(async (client) => {
    const stateRes = await client.query<{ phase: string | null; state_json: Record<string, unknown> }>(
      `SELECT phase, state_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (stateRes.rows[0]?.phase === "completed") {
      throw new Error("The Agent Swarm workflow is already completed.");
    }
    const state = asObject(stateRes.rows[0]?.state_json);
    const completedSwarmNodeIds = asObject(state.completedSwarmNodeIds);
    const compiledNodes = asObject(context.config.compiledSwarm).nodes;
    const nodes = Array.isArray(compiledNodes) ? compiledNodes.map(asObject) : [];
    const startedTaskIds = new Set(Array.isArray(state.startedSwarmWorkerTaskIds)
      ? state.startedSwarmWorkerTaskIds.filter((id): id is string => typeof id === "string")
      : state.workersStartedAt ? context.agents.filter((agent) => agent.role === "worker").map((agent) => agent.task_id) : []);
    const taskIdByLeafId = new Map(context.agents.flatMap((agent) => {
      const leafId = agent.state_json?.swarmLeafId;
      return typeof leafId === "string" ? [[leafId, agent.task_id] as const] : [];
    }));
    const unfinishedChild = nodes.find((node) => node.parentNodeId === target.nodeId
      && typeof node.id === "string"
      && startedTaskIds.has(taskIdByLeafId.get(node.leaderLeafId as string) ?? "")
      && !completedSwarmNodeIds[node.id]);
    if (unfinishedChild) {
      throw new Error(`Nested swarm ${unfinishedChild.id} must publish its output first.`);
    }
    await client.query(
      `INSERT INTO task_workflow_submissions (
        workflow_task_id,
        workflow_agent_id,
        submission_type,
        round_no,
        payload_json
      ) VALUES ($1, $2, 'swarm_output', NULL, $3::jsonb)`,
      [context.workflowTaskId, currentAgent.id, JSON.stringify({ nodeId: target.nodeId, response: trimmed })]
    );
    const messageRes = await client.query<{ message_no: number }>(
      `INSERT INTO task_workflow_messages (
        workflow_task_id,
        channel_id,
        sender_workflow_agent_id,
        content_markdown
      ) VALUES ($1, $2, $3, $4)
      RETURNING message_no`,
      [context.workflowTaskId, target.channelId, currentAgent.id, trimmed]
    );
    await client.query(
      `UPDATE task_workflows
          SET state_json = $2::jsonb,
              updated_at = now()
        WHERE task_id = $1`,
      [context.workflowTaskId, JSON.stringify({
        ...state,
        completedSwarmNodeIds: {
          ...completedSwarmNodeIds,
          [target.nodeId]: { at: new Date().toISOString(), messageNo: messageRes.rows[0].message_no }
        }
      })]
    );
    return messageRes.rows[0];
  });
  if (context.swarm?.pendingNestedSwarmNodeIds) {
    context.swarm.pendingNestedSwarmNodeIds = context.swarm.pendingNestedSwarmNodeIds
      .filter((nodeId) => nodeId !== target.nodeId);
  }
  await markSwarmAgentFinished(context);
  return { messageNo: inserted.message_no };
}

export async function markWorkflowCompleted(
  context: LoadedWorkflowRunContext,
  options: { keepRunId?: string | null; currentRunId?: string | null } = {}
): Promise<boolean> {
  if (
    context.workflowType === "agent_swarm"
    && context.currentAgent
    && (context.taskId !== context.workflowTaskId || context.currentAgent.role !== "leader")
  ) {
    return false;
  }

  const nextStateJson = {
    ...(context.workflowType === "long_horizon"
      ? { currentRound: context.longHorizon?.latestRound ?? 0, approvedRound: context.longHorizon?.approvedRound ?? null }
      : { pausedSwarmAgents: {} })
  };

  const completedWorkflow = await withTransaction(async (client) => {
    const workflowResult = await client.query<{ task_id: string; phase?: string }>(
      `SELECT task_id, phase
         FROM task_workflows
        WHERE task_id = $1
        FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") return false;

    if (options.currentRunId && !(await isTaskRunLatestAttempt(context.taskId, options.currentRunId))) {
      return false;
    }

    await client.query(
      `UPDATE task_workflows
          SET phase = 'completed',
              state_json = $2::jsonb,
              updated_at = now()
        WHERE task_id = $1`,
      [context.workflowTaskId, JSON.stringify(nextStateJson)]
    );

    if (context.workflowType === "agent_swarm") {
      await client.query(
        `WITH RECURSIVE task_scope AS (
           SELECT id
             FROM tasks
            WHERE id = $1
           UNION
           SELECT child.id
             FROM tasks child
             JOIN task_scope parent
               ON child.parent_task_id = parent.id
               OR child.workflow_parent_task_id = parent.id
          )
          UPDATE tasks
             SET cancellation_requested = true,
                 resume_after_interrupt = false,
                 status = CASE WHEN status IN ('starting', 'running') THEN status ELSE 'cancelled' END,
                 completed_at = CASE WHEN status IN ('starting', 'running') THEN completed_at ELSE COALESCE(completed_at, now()) END,
                 updated_at = now()
           WHERE id IN (SELECT id FROM task_scope)
             AND id <> $1`,
        [context.workflowTaskId]
      );
    }

    return true;
  });

  if (!completedWorkflow) {
    return false;
  }

  if (context.workflowType === "agent_swarm") {
    await cancelPendingWorkflowRuns(context.workflowTaskId, options.keepRunId ?? null);
  }

  return true;
}

export async function loadSwarmChannelMessagesForApi(workflowTaskId: string, channelId: string): Promise<Array<{
  id: string;
  channel_id: string;
  sender_task_id: string | null;
  sender_role: string | null;
  sender_slot_index: number | null;
  message_no: number;
  content_markdown: string;
  created_at: string;
}>> {
  const result = await query<{
    id: string;
    channel_id: string;
    sender_task_id: string | null;
    sender_role: string | null;
    sender_slot_index: number | null;
    message_no: number;
    content_markdown: string;
    created_at: string;
  }>(
    `SELECT m.id,
            m.channel_id,
            a.task_id AS sender_task_id,
            a.role AS sender_role,
            a.slot_index AS sender_slot_index,
            m.message_no,
            m.content_markdown,
            m.created_at
       FROM task_workflow_messages m
       LEFT JOIN task_workflow_agents a
         ON a.id = m.sender_workflow_agent_id
      WHERE m.workflow_task_id = $1
        AND m.channel_id = $2
      ORDER BY m.message_no ASC`,
    [workflowTaskId, channelId]
  );

  return result.rows;
}
