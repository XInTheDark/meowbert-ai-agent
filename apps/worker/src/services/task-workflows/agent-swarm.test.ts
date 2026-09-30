import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../../lib/queue.js", () => ({
  taskQueue: {
    getJob: vi.fn()
  }
}));

vi.mock("../agent-db/index.js", () => ({
  isTaskRunLatestAttempt: vi.fn()
}));

vi.mock("./context.js", async () => {
  const actual = await vi.importActual<typeof import("./context.js")>("./context.js");
  return {
    ...actual,
    loadSwarmChannels: vi.fn()
  };
});

vi.mock("./shared.js", async () => {
  const actual = await vi.importActual<typeof import("./shared.js")>("./shared.js");
  return {
    ...actual,
    enqueueWorkflowTaskRun: vi.fn(),
    getSwarmToolOptionsOverride: vi.fn()
  };
});

import { query } from "../../lib/db.js";
import { withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { isTaskRunLatestAttempt } from "../agent-db/index.js";
import { loadSwarmChannels } from "./context.js";
import {
  markWorkflowCompleted,
  recordSwarmFinalReview,
  sendSwarmChannelMessage
} from "./agent-swarm.js";
import { enqueueWorkflowTaskRun, getSwarmToolOptionsOverride } from "./shared.js";

describe("agent swarm workflow helpers", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedTaskQueueGetJob = vi.mocked(taskQueue.getJob);
  const mockedIsTaskRunLatestAttempt = vi.mocked(isTaskRunLatestAttempt);
  const mockedLoadSwarmChannels = vi.mocked(loadSwarmChannels);
  const mockedEnqueueWorkflowTaskRun = vi.mocked(enqueueWorkflowTaskRun);
  const mockedGetSwarmToolOptionsOverride = vi.mocked(getSwarmToolOptionsOverride);
  const transactionClient = {
    query: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuery.mockReset();
    transactionClient.query.mockReset();
    transactionClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    mockedWithTransaction.mockImplementation(async (callback) => callback(transactionClient as never));
    mockedQuery.mockResolvedValue({
      rows: [{ has_cancelled_member: false }],
      rowCount: 1
    } as never);
    mockedTaskQueueGetJob.mockResolvedValue(null as never);
    mockedIsTaskRunLatestAttempt.mockResolvedValue(true);
    mockedLoadSwarmChannels.mockResolvedValue([]);
    mockedEnqueueWorkflowTaskRun.mockResolvedValue({
      runId: "run-1",
      attemptNo: 1
    });
    mockedGetSwarmToolOptionsOverride.mockReturnValue(undefined);
  });

  it("requires the Quality Control worker for a swarm's final review", async () => {
    const context: LoadedWorkflowRunContext = {
      workflowTaskId: "workflow-1",
      workflowType: "agent_swarm",
      phase: "active",
      config: {},
      taskId: "leader-task",
      taskDir: "/tmp/task",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      currentAgent: {
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
      agents: [
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
        {
          id: "quality-agent",
          role: "worker",
          slot_index: 0,
          task_id: "quality-task",
          title: "Quality Control",
          status: "running",
          task_root_path: ".meowbert/task-runs/quality-task",
          last_inbox_refresh_message_no: 0,
          state_json: { agentPresetMode: "quality_control_reviewer" }
        },
        {
          id: "worker-agent",
          role: "worker",
          slot_index: 1,
          task_id: "worker-task",
          title: "Worker 2",
          status: "running",
          task_root_path: ".meowbert/task-runs/worker-task",
          last_inbox_refresh_message_no: 0,
          state_json: {}
        }
      ],
      planContent: null,
      swarm: {
        sharedDir: "/tmp/shared",
        channels: [],
        peerTaskDirs: [],
        globalChannelId: "global-channel",
        latestWorkflowMessageNo: 0,
        leaderGlobalMessageCount: 1,
        activeWorkerCount: 2,
        workerGlobalReportTaskIds: [],
        workerGlobalReportLabels: [],
        missingWorkerGlobalReportTaskIds: [],
        missingWorkerGlobalReportLabels: [],
        workersStartedAt: "2026-08-24T00:00:00.000Z",
        completedReviewRounds: 0,
        finalReview: null
      },
      runtime: {
        lastPassiveRefreshAtMs: 0,
        lastExplicitRefreshWorkflowMessageNo: 0,
        pendingChannelMessageSendAfterRefresh: false
      }
    };

    await expect(recordSwarmFinalReview({
      context,
      reviewer: "Worker 2",
      approved: true,
      summary: "Ready."
    })).rejects.toThrow("Quality Control worker");

    transactionClient.query.mockResolvedValueOnce({ rows: [{ state_json: {} }], rowCount: 1 } as never);
    await expect(recordSwarmFinalReview({
      context,
      reviewer: "Worker 1",
      approved: true,
      summary: "Ready."
    })).resolves.toEqual({ reviewerLabel: "Worker 1", approved: true });
    expect(context.swarm?.finalReview?.approved).toBe(true);
  });

  it("cancels stale queued workflow runs when a swarm completes", async () => {
    const removableJob = {
      getState: vi.fn().mockResolvedValue("delayed"),
      remove: vi.fn().mockResolvedValue(undefined)
    };
    mockedTaskQueueGetJob.mockResolvedValue(removableJob as never);
    transactionClient.query
      .mockResolvedValueOnce({ rows: [{ task_id: "workflow-1" }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ run_id: "run-delayed", task_id: "leader-task" }],
        rowCount: 1
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await markWorkflowCompleted({
      workflowTaskId: "workflow-1",
      workflowType: "agent_swarm",
      phase: "active",
      config: {},
      taskId: "leader-task",
      taskDir: "/tmp/task",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      currentAgent: null,
      agents: [],
      planContent: null,
      runtime: {
        lastPassiveRefreshAtMs: 0,
        lastExplicitRefreshWorkflowMessageNo: 0,
        pendingChannelMessageSendAfterRefresh: false
      }
    }, {
      keepRunId: "run-current"
    });

    expect(mockedTaskQueueGetJob).toHaveBeenCalledWith(expect.stringContaining("leader-task"));
    expect(removableJob.remove).toHaveBeenCalledTimes(1);
    expect(transactionClient.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("FOR UPDATE"),
      ["workflow-1"]
    );
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("exit_reason = 'cancelled'"),
      [["run-delayed"]]
    );
  });

  it("ignores superseded leader runs when completing a swarm workflow", async () => {
    mockedIsTaskRunLatestAttempt.mockResolvedValue(false);
    transactionClient.query.mockResolvedValueOnce({ rows: [{ task_id: "workflow-1" }], rowCount: 1 } as never);

    const completed = await markWorkflowCompleted({
      workflowTaskId: "workflow-1",
      workflowType: "agent_swarm",
      phase: "active",
      config: {},
      taskId: "leader-task",
      taskDir: "/tmp/task",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      currentAgent: null,
      agents: [],
      planContent: null,
      runtime: {
        lastPassiveRefreshAtMs: 0,
        lastExplicitRefreshWorkflowMessageNo: 0,
        pendingChannelMessageSendAfterRefresh: false
      }
    }, {
      currentRunId: "run-stale"
    });

    expect(completed).toBe(false);
    expect(mockedIsTaskRunLatestAttempt).toHaveBeenCalledWith("leader-task", "run-stale");
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining("FOR UPDATE"),
      ["workflow-1"]
    );
    expect(transactionClient.query.mock.invocationCallOrder[0]).toBeLessThan(
      mockedIsTaskRunLatestAttempt.mock.invocationCallOrder[0]
    );
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("accepts the Global channel alias without starting workers", async () => {
    mockedLoadSwarmChannels.mockResolvedValue([
      {
        id: "global-channel",
        kind: "global",
        title: "Global",
        created_at: "2026-03-18T00:00:00.000Z",
        latest_message_no: 30,
        unread_count: 0,
        member_task_ids: ["leader-task", "worker-task-1"]
      }
    ]);
    transactionClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO task_workflow_messages")) {
        return {
          rows: [{ message_no: 31, created_at: "2026-03-18T00:00:31.000Z" }],
          rowCount: 1
        } as never;
      }
      if (sql.includes("SELECT state_json")) {
        return { rows: [{ state_json: {} }], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });

    const context = {
      workflowTaskId: "workflow-1",
      workflowType: "agent_swarm",
      phase: "active",
      config: {},
      taskId: "leader-task",
      taskDir: "/tmp/task",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      currentAgent: {
        id: "leader-agent",
        role: "leader",
        slot_index: 0,
        task_id: "leader-task",
        title: "Leader",
        status: "running",
        task_root_path: ".meowbert/task-runs/leader-task",
        last_inbox_refresh_message_no: 29
      },
      agents: [],
      planContent: null,
      swarm: {
        sharedDir: "/tmp/shared",
        channels: [],
        peerTaskDirs: [],
        globalChannelId: "global-channel",
        latestWorkflowMessageNo: 30,
        leaderGlobalMessageCount: 0,
        activeWorkerCount: 0,
        workerGlobalReportTaskIds: [],
        workerGlobalReportLabels: [],
        missingWorkerGlobalReportTaskIds: ["worker-task-1"],
        missingWorkerGlobalReportLabels: ["Worker 1"],
        workersStartedAt: null
      },
      runtime: {
        lastPassiveRefreshAtMs: 0,
        lastExplicitRefreshWorkflowMessageNo: 29,
        pendingChannelMessageSendAfterRefresh: true
      }
    } satisfies LoadedWorkflowRunContext;

    await expect(sendSwarmChannelMessage(context, {
      channelId: "Global",
      message: "Kickoff",
      pauseAfterSend: true,
      triggerSource: "web",
      selectionUserId: null
    })).rejects.toThrow("pause_after_send: false");
    expect(transactionClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO task_workflow_messages"),
      expect.anything()
    );
    context.runtime.pendingChannelMessageSendAfterRefresh = true;

    const result = await sendSwarmChannelMessage(context, {
      channelId: "Global",
      message: "Kickoff",
      pauseAfterSend: false,
      triggerSource: "web",
      selectionUserId: null
    });

    expect(result).toEqual({
      messageNo: 31,
      createdAt: "2026-03-18T00:00:31.000Z",
      paused: false
    });
    expect(context.swarm?.leaderGlobalMessageCount).toBe(1);
    expect(context.swarm?.latestWorkflowMessageNo).toBe(31);
    expect(context.swarm?.workersStartedAt).toBeNull();
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO task_workflow_messages"),
      ["workflow-1", "global-channel", "leader-agent", "Kickoff"]
    );
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });
});
