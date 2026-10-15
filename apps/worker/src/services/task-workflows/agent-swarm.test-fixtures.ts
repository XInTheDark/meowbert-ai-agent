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

type TestPause = Record<string, unknown>;

function toPauseRow(taskId: string, pause: TestPause) {
  return {
    task_id: taskId,
    swarm_node_id: pause.swarmNodeId ?? null,
    since_message_no: pause.sinceMessageNo ?? 0,
    status: pause.status ?? "Paused.",
    waiting_for_task_ids: pause.waitingForTaskIds ?? [],
    finished_task_ids: pause.finishedTaskIds ?? [],
    trigger_source: pause.triggerSource,
    selection_user_id: pause.selectionUserId ?? null,
    mode: pause.mode
  };
}

// A database client that keeps the workflow state, the swarm pause rows and the stall marker between
// queries. Seed pauses with `pausedSwarmAgents` and the marker with `swarmStall`; getState() reports
// them under the same keys. `runningTaskIds` are the agents reported as having a live run.
export function createStatefulSwarmClient(initialState: Record<string, unknown>, runningTaskIds: string[] = []) {
  const { pausedSwarmAgents, swarmStall, ...workflowState } = initialState;
  let state: Record<string, unknown> = workflowState;
  let phase = "active";
  const pauses = new Map<string, TestPause>(Object.entries((pausedSwarmAgents ?? {}) as Record<string, TestPause>)
    .map(([taskId, pause]) => [taskId, { swarmNodeId: null, selectionUserId: null, ...pause }]));
  let stall = (swarmStall ?? null) as { nudgedTaskId: string; escalated: boolean } | null;
  const removePauses = (taskIds: string[]) => taskIds.flatMap((taskId) => {
    const pause = pauses.get(taskId);
    pauses.delete(taskId);
    return pause ? [toPauseRow(taskId, pause)] : [];
  });

  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("task_workflow_swarm_pauses")) {
        if (sql.includes("DELETE")) {
          const rows = removePauses(sql.includes("ANY(") ? params?.[1] as string[] : [params?.[1] as string]);
          return { rows, rowCount: rows.length };
        }
        if (sql.includes("INSERT")) {
          const [, taskId, swarmNodeId, sinceMessageNo, status, waitingForTaskIds, finishedTaskIds, triggerSource, selectionUserId, mode] = params ?? [];
          pauses.set(taskId as string, { swarmNodeId, sinceMessageNo, status, waitingForTaskIds, finishedTaskIds, triggerSource, selectionUserId, mode });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("UPDATE")) {
          const pause = pauses.get(params?.[1] as string);
          if (pause) pause.finishedTaskIds = params?.[2];
          return { rows: [], rowCount: pause ? 1 : 0 };
        }
        const rows = [...pauses].map(([taskId, pause]) => toPauseRow(taskId, pause));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("task_workflow_swarm_stalls")) {
        if (sql.includes("DELETE")) {
          if (stall && stall.nudgedTaskId !== params?.[1]) stall = null;
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("INSERT")) {
          stall = { nudgedTaskId: params?.[1] as string, escalated: params?.[2] as boolean };
          return { rows: [], rowCount: 1 };
        }
        const rows = stall ? [{ nudged_task_id: stall.nudgedTaskId, escalated: stall.escalated }] : [];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("SELECT state_json") || sql.includes("SELECT phase FROM task_workflows")) {
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
    getState: (): Record<string, unknown> => ({
      ...state,
      pausedSwarmAgents: Object.fromEntries(pauses),
      ...(stall ? { swarmStall: { ...stall } } : {})
    }),
    setPause: (taskId: string, pause: TestPause) => { pauses.set(taskId, { swarmNodeId: null, selectionUserId: null, ...pause }); },
    completeWorkflow: () => { phase = "completed"; }
  };
}
