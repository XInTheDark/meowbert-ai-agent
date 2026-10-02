import type { PlatformUsageBilling } from "@meowbert/shared";

// Platform model calls made for a run are billed to the task's subscription user.
// BYO and ChatGPT runs have no subscription user and are not metered.
export function resolveRunUsageBilling(input: {
  prepared: { subscriptionUserId: string | null };
  job: { taskId: string; runId: string };
}): PlatformUsageBilling | null {
  const userId = input.prepared.subscriptionUserId;
  return userId ? { userId, taskId: input.job.taskId, runId: input.job.runId } : null;
}
