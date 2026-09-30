import { startSubagentWakeLoop } from "./services/subagents/wait.js";
import { startProjectMasterWakeLoop } from "./services/project-master/wake.js";
import { Worker } from "bullmq";
import type { EmailDeliveryJob, TaskExecutionJob } from "@meowbert/shared";
import { EMAIL_DELIVERY_QUEUE_NAME, TASK_QUEUE_NAME, warmStorageBackendsOnStartup } from "@meowbert/shared";
import { config } from "./lib/config.js";
import { redis } from "./lib/redis.js";
import { pool } from "./lib/db.js";
import { closeQueue } from "./lib/queue.js";
import { runAgentJob } from "./services/agent/index.js";
import { startTaskRunRecoveryLoop } from "./services/tasks/task-run-recovery.js";
import { startTaskScheduleLoop } from "./services/task-schedules/service.js";
import { startTaskCleanupLoop } from "./services/tasks/task-cleanup.js";
import { finalizeUnhandledRunFailure } from "./services/tasks/run-failure-fallback.js";
import { processEmailDeliveryJob } from "./services/email/email-delivery.js";
import { stopWorkspaceMemoryWatchers } from "./services/memory/index.js";
import { scheduleTaskRunRetry } from "./services/tasks/task-run-retry.js";
import { startTaskTimeLimitLoop } from "./services/tasks/task-time-limit.js";
import { startAdminRuntimeMigrationLoop } from "./services/admin-migrations/runtime-migrations.js";
import { startWorkspaceStorageMigrationLoop } from "./services/storage/workspace-storage-migrations.js";
import { storageBackendRegistry } from "./services/storage/backend-registry.js";
import { startTaskRunDispatchLoop } from "./services/tasks/task-run-dispatch.js";
import { startTaskHistoryArchiveLoop } from "./services/tasks/task-history-archive-loop.js";
import { startTaskHistoryArchiveRequestLoop } from "./services/tasks/task-history-archive-request-loop.js";
import { startSandboxOrphanCleanupLoop } from "./services/tasks/sandbox-orphan-cleanup.js";
import { startEventRetentionCleanupLoop } from "./services/tasks/event-retention.js";
import { workerSandboxManager } from "./services/runtime/sandbox.js";
import { restorePersistentShellExpiryTimers } from "./services/runtime/persistent-shell-sessions.js";
import { startMemorySynthesisEventListener } from "./services/memory-synthesis/service.js";

import { startRunDeliveryLoop } from "./services/notifications/run-delivery-loop.js";
import { startUsageActivationLoop } from "./services/usage-activation/service.js";

async function waitForSchema(maxRetries = 60, intervalMs = 2000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await pool.query<{ t: string | null }>(
        "SELECT to_regclass('public.tasks') AS t"
      );
      if (result.rows[0]?.t) {
        console.log("[worker] Schema ready (tasks table exists)");
        return;
      }
    } catch {
      // DB or table not ready yet
    }
    console.log(`[worker] Waiting for schema… (${i + 1}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    "[worker] Schema not ready after max retries. Ensure the API has started and applied migrations."
  );
}

async function start(): Promise<void> {
  await workerSandboxManager.assertImageAvailable();
  await waitForSchema();
  await restorePersistentShellExpiryTimers();
  await warmStorageBackendsOnStartup(storageBackendRegistry, {
    logger: {
      info: (message: string) => console.info(message),
      warn: (message: string) => console.warn(message),
      error: (message: string) => console.error(message)
    }
  });

  const worker = new Worker<TaskExecutionJob>(
    TASK_QUEUE_NAME,
    async (job) => {
      await runAgentJob(job.data);
    },
    {
      connection: redis,
      concurrency: config.runtime.workerConcurrency
    }
  );

  const emailWorker = new Worker<EmailDeliveryJob>(
    EMAIL_DELIVERY_QUEUE_NAME,
    async (job) => {
      await processEmailDeliveryJob(job.data.outboxEmailId);
    },
    {
      connection: redis,
      concurrency: Math.max(1, Math.min(8, config.runtime.workerConcurrency)),
      limiter: {
        max: config.email.queue.globalRatePerMinute,
        duration: 60_000
      }
    }
  );

  const runDeliveryLoop = startRunDeliveryLoop();
  const usageActivationLoop = startUsageActivationLoop();
  const subagentWakeLoop = startSubagentWakeLoop();
  const projectMasterWakeLoop = startProjectMasterWakeLoop();
  const taskRunRecoveryLoop = startTaskRunRecoveryLoop();
  const taskScheduleLoop = startTaskScheduleLoop();
  const taskCleanupLoop = startTaskCleanupLoop();
  const taskTimeLimitLoop = startTaskTimeLimitLoop();
  const taskRunDispatchLoop = startTaskRunDispatchLoop();
  const taskHistoryArchiveLoop = startTaskHistoryArchiveLoop();
  const taskHistoryArchiveRequestLoop = startTaskHistoryArchiveRequestLoop();
  const eventRetentionCleanupLoop = startEventRetentionCleanupLoop();
  const adminRuntimeMigrationLoop = startAdminRuntimeMigrationLoop();
  const workspaceStorageMigrationLoop = startWorkspaceStorageMigrationLoop();
  const sandboxOrphanCleanupLoop = startSandboxOrphanCleanupLoop();
  const memorySynthesisEventListener = startMemorySynthesisEventListener();

  worker.on("ready", () => {
    console.log("Worker ready");
  });

  worker.on("completed", (job) => {
    console.log(`Task completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Task failed: ${job?.id}`, error);
    if (!job?.data) {
      return;
    }

    void (async () => {
      const retryResult = await scheduleTaskRunRetry({
        job: job.data,
        error
      });
      if (retryResult.status === "scheduled" || retryResult.status === "noop") {
        return;
      }

      await finalizeUnhandledRunFailure({
        taskId: job.data.taskId,
        runId: job.data.runId,
        error
      });
    })().catch((finalizeError) => {
      console.error(
        `Failed to handle unhandled run error for task ${job.data.taskId} / run ${job.data.runId}`,
        finalizeError
      );
    });
  });

  emailWorker.on("ready", () => {
    console.log("Email worker ready");
  });

  emailWorker.on("failed", (job, error) => {
    console.error(`Email delivery failed: ${job?.id}`, error);
  });

  async function shutdown(): Promise<void> {
    await usageActivationLoop.stop();
    await stopWorkspaceMemoryWatchers();
    await taskCleanupLoop.stop();
    await taskScheduleLoop.stop();
    await subagentWakeLoop.stop();
    await projectMasterWakeLoop.stop();
    await taskRunRecoveryLoop.stop();
    await taskTimeLimitLoop.stop();
    await taskRunDispatchLoop.stop();
    await taskHistoryArchiveLoop.stop();
    await taskHistoryArchiveRequestLoop.stop();
    await eventRetentionCleanupLoop.stop();
    await adminRuntimeMigrationLoop.stop();
    await workspaceStorageMigrationLoop.stop();
    await sandboxOrphanCleanupLoop.stop();
    await memorySynthesisEventListener.stop();
    await worker.close();
    await emailWorker.close();
    await runDeliveryLoop.stop();
    await closeQueue();
    await redis.quit();
    await pool.end();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
