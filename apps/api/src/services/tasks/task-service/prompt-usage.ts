import type { TaskSource } from "@meowbert/shared";
import {
  getPromptEntitlementStatus,
  recordPromptUsageIfRequired,
  type PromptEntitlementStatus
} from "../../billing/entitlements.js";

function isNonEmptyUserId(userId: string | null | undefined): userId is string {
  return typeof userId === "string" && userId.trim().length > 0;
}

function describeTaskSource(source: TaskSource): string {
  return source === "web" ? "Web" : `${source[0].toUpperCase()}${source.slice(1)} connector`;
}

export class TaskPromptEntitlementError extends Error {
  readonly entitlement: PromptEntitlementStatus;

  constructor(entitlement: PromptEntitlementStatus) {
    super(entitlement.reason ?? "Prompt entitlement exceeded.");
    this.name = "TaskPromptEntitlementError";
    this.entitlement = entitlement;
  }
}

export class TaskExecutionUserRequiredError extends Error {
  constructor(source: TaskSource) {
    super(`${describeTaskSource(source)} execution requires an accountable user.`);
    this.name = "TaskExecutionUserRequiredError";
  }
}

export async function ensureTaskPromptEntitlement(input: {
  source: TaskSource;
  userId?: string | null;
}): Promise<PromptEntitlementStatus | null> {
  if (input.source === "web") {
    return null;
  }

  if (!isNonEmptyUserId(input.userId)) {
    throw new TaskExecutionUserRequiredError(input.source);
  }

  const entitlement = await getPromptEntitlementStatus(input.userId);
  if (!entitlement.allowed) {
    throw new TaskPromptEntitlementError(entitlement);
  }

  return entitlement;
}

export async function recordTaskPromptUsage(input: {
  entitlement: PromptEntitlementStatus | null;
  userId?: string | null;
  taskId: string;
  taskMessageId: string;
}): Promise<void> {
  if (!input.entitlement || !isNonEmptyUserId(input.userId)) {
    return;
  }

  await recordPromptUsageIfRequired({
    userId: input.userId,
    mode: input.entitlement.mode,
    taskId: input.taskId,
    taskMessageId: input.taskMessageId
  });
}
