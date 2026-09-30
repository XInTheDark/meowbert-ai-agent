import type { TaskExecutionJob } from "@meowbert/shared";

export function shouldResolveContinuationBranch(runKind: TaskExecutionJob["mode"] | undefined): boolean {
  return runKind !== "scheduled_auto" && runKind !== "infinite_auto";
}
