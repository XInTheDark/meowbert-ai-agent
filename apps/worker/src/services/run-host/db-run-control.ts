import { loadConversationNavigation, type TaskExecutionJob } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import {
  appendMessage,
  consumeCommandInterruptForStep,
  isCancellationRequested,
  isTaskRunLatestAttempt,
  setTaskBranchSelection,
  setTaskStatusForRun
} from "../agent-db/index.js";
import { emitTaskEvent } from "../runtime/events.js";
import { isTaskDebugModeEnabled, type TaskDebugLogger } from "../runtime/debug-task-events.js";
import { watchRunCancellation } from "../agent/cancellation-batch.js";
import { createDbContextStore } from "../context-management-v2/db-store.js";
import type { RunControl } from "@meowbert/run-executor/agent/ports/run-control";
import type { ServerRunState } from "./bootstrap.js";
import { createDbPlatformToolHost } from "./platform-tools.js";
import { clearInterruptedToolCalls, recordToolCallFinished, recordToolCallStarted } from "./tool-call-records.js";

export interface DbRunControl extends RunControl {
  // The control plane's state for the run, available once `bootstrap` has resolved.
  serverState(): ServerRunState;
}

async function setGeneratedTaskTitle(taskId: string, title: string): Promise<void> {
  await query(
    `UPDATE tasks
        SET title = $2,
            updated_at = now()
      WHERE id = $1
        AND (
          title IS NULL
          OR btrim(title) = ''
          OR title = 'New Task'
          OR lower(btrim(title)) = 'telegram task'
          OR lower(btrim(title)) = 'discord task'
          OR lower(btrim(title)) = 'github task'
          OR lower(btrim(title)) = 'email task'
        )`,
    [taskId, title]
  );
}

// Bootstrapping resolves the model route, which can take a while; a cancellation meanwhile aborts it.
// Run start and end pull in most of the control plane, so those modules load on first use.
async function loadCancellableServerRunState(job: TaskExecutionJob, debugLogger: TaskDebugLogger): Promise<ServerRunState> {
  const { loadServerRunState } = await import("./bootstrap.js");
  const controller = new AbortController();
  const stopWatching = watchRunCancellation(job.taskId, job.runId, () => controller.abort(new Error("TASK_CANCELLED")));
  try {
    return await loadServerRunState(job, debugLogger, controller.signal);
  } finally {
    stopWatching();
  }
}

// RunControl for an executor inside the control plane: every call goes straight to the database.
// `state` resumes a run the control plane already bootstrapped.
export function createDbRunControl(
  job: TaskExecutionJob,
  debugLogger: TaskDebugLogger,
  options: { state?: ServerRunState } = {}
): DbRunControl {
  const { taskId, runId } = job;
  let state: ServerRunState | null = options.state ?? null;
  let bootstrapping: Promise<ServerRunState> | null = null;
  const serverState = (): ServerRunState => {
    if (!state) {
      throw new Error("The run has not been bootstrapped.");
    }
    return state;
  };

  return {
    serverState,
    async bootstrap() {
      bootstrapping ??= loadCancellableServerRunState(job, debugLogger).then((loaded) => {
        state = loaded;
        return loaded;
      });
      return (await bootstrapping).bootstrap;
    },
    setTaskStatus: (status) => setTaskStatusForRun(taskId, runId, status),
    async readCancellation() {
      const [cancelRequested, latestAttempt] = await Promise.all([
        isCancellationRequested(taskId),
        isTaskRunLatestAttempt(taskId, runId)
      ]);
      return { cancelRequested, latestAttempt };
    },
    watchCancellation: (notify) => watchRunCancellation(taskId, runId, notify),
    consumeCommandInterrupt: (step) => consumeCommandInterruptForStep(runId, step),
    appendMessage: (input) => appendMessage(taskId, input.role, input.content, {
      parentMessageId: input.parentMessageId,
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.reasoningContentCount !== undefined ? { reasoningContentCount: input.reasoningContentCount } : {}),
      ...(input.organizationSnapshots?.length ? { organizationSnapshots: input.organizationSnapshots } : {})
    }),
    async selectBranch(messageId) {
      if (job.selectionUserId) {
        await setTaskBranchSelection(taskId, job.selectionUserId, messageId);
      }
    },
    emitEvent: (type, payload) => emitTaskEvent(taskId, type, payload),
    isDebugEnabled: () => isTaskDebugModeEnabled(),
    loadConversationNavigation: (leafMessageId) => loadConversationNavigation({ query }, taskId, leafMessageId),
    setGeneratedTitle: (title) => setGeneratedTaskTitle(taskId, title),
    recordToolCallStart: (call) => recordToolCallStarted(taskId, runId, call),
    recordToolCallResult: ({ callId }) => recordToolCallFinished(runId, callId),
    resolveInterruptedToolCalls: (callIds) => clearInterruptedToolCalls(taskId, callIds),
    context: createDbContextStore(taskId),
    platform: createDbPlatformToolHost(serverState),
    complete: async (completion) => (await import("./run-completion.js")).completeServerRun(serverState(), completion),
    fail: async (failure) => (await import("./run-failure.js")).failServerRun(job, failure)
  };
}
