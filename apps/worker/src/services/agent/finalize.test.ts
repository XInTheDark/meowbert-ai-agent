import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn().mockResolvedValue("assistant-message-1"),
  recordRunCompletion: vi.fn().mockResolvedValue(undefined),
  setTaskBranchSelection: vi.fn().mockResolvedValue(undefined),
  setTaskStatusForRun: vi.fn().mockResolvedValue(true)
}));

vi.mock("../tasks/complete-task-run.js", () => ({ completeTaskRun: vi.fn().mockResolvedValue(true) }));
vi.mock("../notifications/run-delivery-loop.js", () => ({ wakeRunDeliveryLoop: vi.fn() }));

vi.mock("../task-schedules/service.js", () => ({
  applyInfiniteWait: vi.fn().mockResolvedValue(undefined),
  pauseInfiniteScheduleAfterCheckin: vi.fn().mockResolvedValue(undefined),
  pauseTimedScheduleAfterCompletion: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../task-workflows/service.js", () => ({
  enqueueWorkflowTaskRun: vi.fn().mockResolvedValue({ runId: "run-2", attemptNo: 2 }),
  markWorkflowCompleted: vi.fn().mockResolvedValue(false)
}));

import { appendMessage, recordRunCompletion, setTaskStatusForRun } from "../agent-db/index.js";
import { emitTaskEvent } from "../runtime/events.js";
import { enqueueWorkflowTaskRun, markWorkflowCompleted } from "../task-workflows/service.js";
import { finalizeAgentRun } from "./finalize.js";
import { completeTaskRun } from "../tasks/complete-task-run.js";
import { applyInfiniteWait, pauseTimedScheduleAfterCompletion } from "../task-schedules/service.js";

function createExecution() {
  const cancellationMonitor = {
    signal: new AbortController().signal,
    assertNotCancelled: vi.fn(async () => {}),
    stop: vi.fn()
  };

  return {
    job: {
      taskId: "task-1",
      runId: "run-1",
      mode: "agent_swarm_worker",
      triggerSource: "web",
      selectionUserId: null
    },
    prepared: {
      isSubtask: false,
      taskDir: "/tmp/task-1",
      cancellationMonitor,
      runtimeAgentId: "default",
      runtimeCompatibilityModes: [],
      runPersistedItems: [],
      snapshot: {
        task: {
          workspace_id: "workspace-1",
          environment_id: "environment-1",
          connector_context_id: null
        }
      }
    },
    debugLogger: {
      log: vi.fn(async () => {}),
      stage: vi.fn()
    },
    workflow: {
      workflowContext: {
        workflowTaskId: "workflow-1",
        workflowType: "agent_swarm",
        phase: "active"
      }
    },
    runControl: {
      isTimedInfiniteRun: false,
      reachedMaxRunSteps: false,
      timedRunFinalizing: false,
      runTimedOut: false
    },
    state: {
      currentLeafMessageId: null,
      dispatchState: {
        finalResponseSegments: []
      },
      finalResponseFromTool: null,
      waitRequest: null,
      stopRequest: null,
      workflowPauseRequest: { kind: "agent_swarm_paused" },
      workflowAssistantPauseResponse: null,
      notificationRequested: true
    },
    assertRunNotAborted: vi.fn(async () => {})
  } as never;
}

describe("finalizeAgentRun", () => {
  const mockedAppendMessage = vi.mocked(appendMessage);
  const mockedEnqueueWorkflowTaskRun = vi.mocked(enqueueWorkflowTaskRun);
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);
  const mockedRecordRunCompletion = vi.mocked(recordRunCompletion);
  const mockedSetTaskStatusForRun = vi.mocked(setTaskStatusForRun);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes timed wrap-up and pauses the schedule without scheduling another cycle", async () => {
    const execution = createExecution() as any;
    execution.job.mode = "infinite_auto";
    execution.workflow.workflowContext = null;
    execution.state.workflowPauseRequest = null;
    execution.state.finalResponseFromTool = { response: "Timed run finished.", notify: true };
    execution.runControl.isTimedInfiniteRun = true;
    execution.runControl.runTimedOut = true;
    execution.runControl.timedRunFinalizing = true;
    execution.assertRunNotAborted.mockRejectedValue(new Error("RUN_TIME_LIMIT_REACHED"));

    await finalizeAgentRun(execution);

    expect(completeTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1", runId: "run-1", finalResponse: "Timed run finished.", notificationRequested: true
    }));
    expect(pauseTimedScheduleAfterCompletion).toHaveBeenCalledWith("task-1");
    expect(applyInfiniteWait).not.toHaveBeenCalled();
    expect(execution.assertRunNotAborted).not.toHaveBeenCalled();
  });

  it("finishes a swarm pause without adding conversation history or re-queueing when no pause text was provided", async () => {
    const execution = createExecution();

    await finalizeAgentRun(execution);

    expect(mockedAppendMessage).not.toHaveBeenCalled();
    expect(mockedSetTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-1", "queued");
    expect(mockedRecordRunCompletion).toHaveBeenCalledWith("run-1", "completed", undefined, false);
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });

  it("appends an assistant message with pause text when swarm pause has a response message", async () => {
    const execution = createExecution() as any;
    execution.state.workflowAssistantPauseResponse = "Candidate solution is ready for review.";
    execution.prepared.runPersistedItems = [
      { type: "function_call", call_id: "c1", name: "send_channel_message", arguments: "{}" }
    ];

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      {
        text: "Candidate solution is ready for review.",
        response_items: [
          { type: "function_call", call_id: "c1", name: "send_channel_message", arguments: "{}" }
        ]
      },
      expect.objectContaining({
        parentMessageId: null,
        agentId: "default"
      })
    );
    expect(mockedSetTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-1", "queued");
    expect(mockedRecordRunCompletion).toHaveBeenCalledWith("run-1", "completed", undefined, false);
  });

  it("completes the root task run after the swarm workflow is marked completed", async () => {
    const execution = createExecution() as any;
    execution.job.mode = "agent_swarm_leader";
    execution.job.taskId = "workflow-1";
    execution.workflow.workflowContext = {
      ...execution.workflow.workflowContext,
      taskId: "workflow-1",
      workflowTaskId: "workflow-1",
      currentAgent: { role: "leader" }
    };
    execution.state.workflowPauseRequest = null;
    execution.state.finalResponseFromTool = { response: "Swarm finished.", notify: true };
    vi.mocked(markWorkflowCompleted).mockResolvedValueOnce(true);

    await finalizeAgentRun(execution);

    expect(markWorkflowCompleted).toHaveBeenCalledWith(expect.objectContaining({
      workflowTaskId: "workflow-1"
    }), expect.objectContaining({
      keepRunId: "run-1",
      currentRunId: "run-1"
    }));
    expect(completeTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "workflow-1",
      runId: "run-1",
      finalResponse: "Swarm finished."
    }));
  });

  it("persists the preserved reasoning content count in assistant message metadata", async () => {
    const execution = createExecution() as any;
    execution.state.workflowPauseRequest = null;
    execution.state.finalResponseFromTool = { response: "Completed work.", notify: false };
    execution.prepared.runPersistedItems = [
      { type: "reasoning", encrypted_content: "encrypted", summary: [] },
      { type: "reasoning", encrypted_content: null, summary: [] }
    ];

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.any(Object),
      expect.objectContaining({
        reasoningContentCount: 1
      })
    );
  });

  it("uses the max-steps fallback message only when the loop truly exhausted its step budget", async () => {
    const execution = createExecution() as any;
    execution.job.mode = "default";
    execution.workflow.workflowContext = null;
    execution.state.waitRequest = null;
    execution.runControl.reachedMaxRunSteps = true;

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.objectContaining({
        text: "Reached max reasoning steps; please send a follow-up message to continue."
      }),
      expect.any(Object)
    );
    expect(execution.debugLogger.log).toHaveBeenCalledWith(
      "Finalizing run without an explicit final response.",
      expect.objectContaining({
        stage: "run.finalize.missing_final_response",
        phase: "warn",
        reachedMaxRunSteps: true
      })
    );
  });

  it("uses a generic fallback message when the run stopped early without exhausting steps", async () => {
    const execution = createExecution() as any;
    execution.job.mode = "default";
    execution.workflow.workflowContext = null;
    execution.state.waitRequest = null;
    execution.runControl.reachedMaxRunSteps = false;

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.objectContaining({
        text: "The run stopped before producing a final response; please send a follow-up message to continue."
      }),
      expect.any(Object)
    );
    expect(execution.debugLogger.log).toHaveBeenCalledWith(
      "Finalizing run without an explicit final response.",
      expect.objectContaining({
        stage: "run.finalize.missing_final_response",
        phase: "warn",
        reachedMaxRunSteps: false
      })
    );
  });

  it("truncates the assistant message preview in task logs", async () => {
    const execution = createExecution() as any;
    const finalResponse = "x".repeat(140);
    execution.state.waitRequest = null;
    execution.state.finalResponseFromTool = {
      response: finalResponse,
      notify: false
    };

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.objectContaining({
        text: finalResponse
      }),
      expect.any(Object)
    );
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-1", "log", {
      message: `${"x".repeat(97)}...`
    });
  });

  it("force-deduplicates repeated final_response text when compatibility mode is enabled", async () => {
    const execution = createExecution() as any;
    execution.prepared.runtimeCompatibilityModes = ["forceFixDoubleResponse"];
    execution.state.waitRequest = null;
    execution.state.finalResponseFromTool = {
      response: "Done.\n\nDetails are above.\n\nDone.\n\nDetails are above.",
      notify: false
    };

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.objectContaining({
        text: "Done.\n\nDetails are above."
      }),
      expect.any(Object)
    );
  });

  it("force-deduplicates final_response text with whitespace between copies", async () => {
    const execution = createExecution() as any;
    execution.prepared.runtimeCompatibilityModes = ["forceFixDoubleResponse"];
    execution.job.mode = "default";
    execution.workflow.workflowContext = null;
    execution.state.waitRequest = null;
    execution.state.finalResponseFromTool = {
      response: "Plain answer.\n  \nPlain answer.",
      notify: true
    };

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.objectContaining({
        text: "Plain answer."
      }),
      expect.any(Object)
    );
  });

  it("force-deduplicates final answers repeated more than twice", async () => {
    const execution = createExecution() as any;
    const answer = [
      "Exactly. So the 1D subproblem is:",
      "",
      "> Given a multiset of values, find a window that contains the most of them.",
      "",
      "When a new point x enters, which existing active points change?"
    ].join("\n");
    execution.prepared.runtimeCompatibilityModes = ["forceFixDoubleResponse"];
    execution.state.waitRequest = null;
    execution.state.finalResponseFromTool = {
      response: [answer, answer, answer].join("\n"),
      notify: false
    };

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.objectContaining({
        text: answer
      }),
      expect.any(Object)
    );
  });

  it("does not force-deduplicate wait responses", async () => {
    const execution = createExecution() as any;
    execution.prepared.runtimeCompatibilityModes = ["forceFixDoubleResponse"];
    execution.state.waitRequest = {
      response: "Wait.\n\nWait.",
      notify: false,
      seconds: null,
      nextRunAt: null
    };

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.objectContaining({
        text: "Wait.\n\nWait."
      }),
      expect.any(Object)
    );
  });

  it("does not concatenate earlier final_response calls into the latest final answer", async () => {
    const execution = createExecution() as any;
    execution.job.mode = "default";
    execution.workflow.workflowContext = null;
    execution.state.waitRequest = null;
    execution.state.dispatchState.finalResponseSegments = [
      {
        response: "Take a close look at line 25.",
        notify: true,
        partial: false
      },
      {
        response: "How does std::max handle three values?",
        notify: true,
        partial: false
      }
    ];

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.objectContaining({
        text: "How does std::max handle three values?"
      }),
      expect.any(Object)
    );
  });

  it("deduplicates overlapping partial final_response text", async () => {
    const execution = createExecution() as any;
    execution.job.mode = "default";
    execution.workflow.workflowContext = null;
    execution.state.waitRequest = null;
    execution.state.dispatchState.finalResponseSegments = [
      {
        response: "Take a close look at how you called std::max on line 25.",
        notify: true,
        partial: true
      },
      {
        response: "Take a close look at how you called std::max on line 25.\n\nHow does std::max handle an initializer list?",
        notify: true,
        partial: false
      }
    ];

    await finalizeAgentRun(execution as never);

    expect(mockedAppendMessage).toHaveBeenCalledWith(
      "task-1",
      "assistant",
      expect.objectContaining({
        text: "Take a close look at how you called std::max on line 25.\n\nHow does std::max handle an initializer list?"
      }),
      expect.any(Object)
    );
  });
});
