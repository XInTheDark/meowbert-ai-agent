import fs from "node:fs/promises";
import type { TaskWorkflowType } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { resolveTaskDir } from "../tasks/task-paths.js";
import { buildSwarmContext, loadSwarmChannels } from "./swarm-context.js";
import * as contextTypes from "./context-types.js";
import { buildLongHorizonContext } from "./long-horizon-context.js";
import {
  coerceNullableString,
  type WorkflowAgentRecord,
  type WorkflowAgentRole
} from "./shared.js";

export type {
  SwarmChannelSummary,
  SwarmInboxRefreshResult,
  LoadedWorkflowRunContext,
  WorkflowPromptContext
} from "./context-types.js";
export { loadSwarmChannels };

async function loadWorkflowAgents(workflowTaskId: string): Promise<WorkflowAgentRecord[]> {
  const agentsRes = await query<{
    id: string;
    role: WorkflowAgentRole;
    slot_index: number;
    task_id: string;
    title: string | null;
    status: string;
    task_root_path: string;
    last_inbox_refresh_message_no: number;
    state_json: Record<string, unknown>;
  }>(
    `SELECT a.id,
            a.role,
            a.slot_index,
            a.task_id,
            t.title,
            t.status,
            t.task_root_path,
            a.last_inbox_refresh_message_no,
            a.state_json
       FROM task_workflow_agents a
       JOIN tasks t ON t.id = a.task_id
      WHERE a.workflow_task_id = $1
      ORDER BY CASE a.role WHEN 'leader' THEN 0 WHEN 'main' THEN 0 ELSE 1 END, a.slot_index ASC, a.task_id ASC`,
    [workflowTaskId]
  );

  return agentsRes.rows;
}

async function loadPlanContent(workflowTaskId: string): Promise<string | null> {
  const planRes = await query<{ payload_json: { plan?: string } }>(
    `SELECT payload_json
       FROM task_workflow_submissions
      WHERE workflow_task_id = $1
        AND submission_type = 'plan'
      ORDER BY created_at DESC
      LIMIT 1`,
    [workflowTaskId]
  );

  return coerceNullableString(planRes.rows[0]?.payload_json?.plan) ?? null;
}

export async function loadWorkflowRunContext(input: {
  taskId: string;
  envRoot: string;
  workspaceId: string;
}): Promise<contextTypes.LoadedWorkflowRunContext | null> {
  const taskRes = await query<{
    id: string;
    task_root_path: string;
    workflow_type: TaskWorkflowType | null;
    workflow_parent_task_id: string | null;
    workspace_id: string;
    environment_id: string;
  }>(
    `SELECT id, task_root_path, workflow_type, workflow_parent_task_id, workspace_id, environment_id
       FROM tasks
      WHERE id = $1`,
    [input.taskId]
  );
  const task = taskRes.rows[0] ?? null;
  if (!task?.workflow_type) {
    return null;
  }

  const workflowTaskId = task.workflow_parent_task_id ?? task.id;
  const workflowRes = await query<{
    workflow_type: TaskWorkflowType;
    phase: string;
    config_json: Record<string, unknown>;
    state_json: Record<string, unknown>;
  }>(
    `SELECT workflow_type, phase, config_json, state_json
       FROM task_workflows
      WHERE task_id = $1`,
    [workflowTaskId]
  );
  const workflow = workflowRes.rows[0] ?? null;
  if (!workflow) {
    return null;
  }

  const agents = await loadWorkflowAgents(workflowTaskId);
  const currentAgent = agents.find((agent) => agent.task_id === input.taskId) ?? null;
  const workflowTaskDir = resolveTaskDir(
    input.envRoot,
    agents.find((agent) => agent.task_id === workflowTaskId)?.task_root_path ?? task.task_root_path
  );

  const context: contextTypes.LoadedWorkflowRunContext = {
    workflowTaskId,
    workflowType: workflow.workflow_type,
    phase: workflow.phase,
    config: workflow.config_json ?? {},
    taskId: input.taskId,
    workflowTaskDir,
    taskDir: resolveTaskDir(input.envRoot, task.task_root_path),
    workspaceId: task.workspace_id,
    environmentId: task.environment_id,
    currentAgent,
    agents,
    planContent: await loadPlanContent(workflowTaskId)
  };

  if (workflow.workflow_type === "long_horizon") {
    context.longHorizon = await buildLongHorizonContext({
      workflowTaskId,
      configJson: workflow.config_json ?? {},
      stateJson: workflow.state_json ?? {}
    });
  }

  if (workflow.workflow_type === "agent_swarm") {
    context.swarm = await buildSwarmContext({
      workflowTaskId,
      taskId: input.taskId,
      envRoot: input.envRoot,
      currentAgentId: currentAgent?.id ?? null,
      agents,
      configJson: workflow.config_json ?? {},
      stateJson: workflow.state_json ?? {}
    });
  }

  await fs.mkdir(workflowTaskDir, { recursive: true });
  return context;
}
