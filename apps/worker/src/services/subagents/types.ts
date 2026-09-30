import type { TaskExecutionJob } from "@meowbert/shared";
import type { TaskMessageToolOptions } from "../agent/types.js";

export interface SubagentRuntime {
  model: string;
  payload: Record<string, unknown>;
  provider: { kind: "platform" | "byo" | "chatgpt"; baseUrl: string };
}

export interface SubagentCaller {
  taskId: string;
  workspaceId: string;
  environmentId: string;
}

export interface SpawnSubagentInput extends SubagentCaller {
  message: string;
  title: string | null;
  model: "default" | "fast";
  runtime: SubagentRuntime;
  tools: TaskMessageToolOptions;
  spawnKey: string;
  start?: boolean;
}

export interface SubagentTask {
  id: string;
  parent_task_id: string | null;
  root_task_id: string;
  workspace_id: string;
  environment_id: string;
  initiator_user_id: string | null;
  default_timezone: string;
  subtask_depth: number;
  task_root_path: string;
  status: string;
  cancellation_requested: boolean;
}

export interface SubagentWait {
  task_id: string;
  run_id: string;
  resume_job_json: TaskExecutionJob;
  deadline_at: string;
}
