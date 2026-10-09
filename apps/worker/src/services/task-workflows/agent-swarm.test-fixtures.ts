import { vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

// Shared by the swarm mailbox and stall tests: a flat swarm with one leader and two workers.
export function createSwarmTestContext(taskId = "leader-task"): LoadedWorkflowRunContext {
  const agents: LoadedWorkflowRunContext["agents"] = [
    {
      id: "leader-agent",
      role: "leader",
      slot_index: 0,
      task_id: "leader-task",
      title: "Leader",
      status: "running",
      task_root_path: ".meowbert/task-runs/leader-task",
      last_inbox_refresh_message_no: 0,
      state_json: {}
    },
    ...[1, 2].map((number) => ({
      id: `worker-agent-${number}`,
      role: "worker" as const,
      slot_index: number - 1,
      task_id: `worker-task-${number}`,
      title: `Worker ${number}`,
      status: "queued",
      task_root_path: `.meowbert/task-runs/worker-task-${number}`,
      last_inbox_refresh_message_no: 0,
      state_json: {}
    }))
  ];
  return {
    workflowTaskId: "leader-task",
    workflowType: "agent_swarm",
    phase: "active",
    config: {},
    taskId,
    taskDir: "/tmp/task",
    workspaceId: "workspace-1",
    environmentId: "environment-1",
    currentAgent: agents.find((agent) => agent.task_id === taskId) ?? null,
    agents,
    planContent: null,
    swarm: {
      sharedDir: "/tmp/shared",
      channels: [],
      peerTaskDirs: [],
      globalChannelId: "global-channel",
      latestWorkflowMessageNo: 10,
      leaderGlobalMessageCount: 1,
      activeWorkerCount: 2,
      workerGlobalReportTaskIds: [],
      workerGlobalReportLabels: [],
      missingWorkerGlobalReportTaskIds: ["worker-task-1", "worker-task-2"],
      missingWorkerGlobalReportLabels: ["Worker 1", "Worker 2"],
      workersStartedAt: "2026-08-27T00:00:00.000Z",
      completedReviewRounds: 0,
      finalReview: null
    }
  };
}

export function createSwarmTestPause(
  mode: "agent_swarm_leader" | "agent_swarm_worker",
  waitingForTaskIds: string[] = []
) {
  return {
    sinceMessageNo: 10,
    status: "Paused.",
    waitingForTaskIds,
    finishedTaskIds: [],
    triggerSource: "web",
    selectionUserId: null,
    mode
  };
}

// A database client that keeps the workflow state between queries. `runningTaskIds` are the agents
// reported as having a live run.
export function createStatefulSwarmClient(initialState: Record<string, unknown>, runningTaskIds: string[] = []) {
  let state = initialState;
  let phase = "active";
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT state_json")) {
        return { rows: [{ state_json: state, phase }], rowCount: 1 };
      }
      if (sql.includes("FROM tasks t")) {
        const candidates = (params?.[0] as string[]) ?? [];
        const rows = candidates.filter((id) => runningTaskIds.includes(id)).map((id) => ({ id }));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("UPDATE task_workflows") && typeof params?.[1] === "string") {
        state = JSON.parse(params[1]) as Record<string, unknown>;
      }
      return { rows: [], rowCount: 0 };
    })
  };
  return {
    client,
    getState: () => state,
    completeWorkflow: () => { phase = "completed"; }
  };
}
