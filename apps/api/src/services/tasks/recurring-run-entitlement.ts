import { query } from "../../lib/db.js";
import { getPromptEntitlementStatus, type PromptEntitlementStatus } from "../billing/entitlements.js";
import { recordUserFreeMessageEvent } from "../billing/subscriptions.js";

interface RecurringRunAccountabilityRow {
  created_by_user_id: string | null;
  initiator_user_id: string | null;
}

export class RecurringRunAccountabilityError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("Recurring task execution requires an accountable user.");
    this.name = "RecurringRunAccountabilityError";
  }
}

export class RecurringRunEntitlementError extends Error {
  readonly entitlement: PromptEntitlementStatus;
  readonly statusCode = 429;

  constructor(entitlement: PromptEntitlementStatus) {
    super(entitlement.reason ?? "Recurring task prompt entitlement exceeded.");
    this.name = "RecurringRunEntitlementError";
    this.entitlement = entitlement;
  }
}

export async function resolveRecurringRunPromptEntitlement(taskId: string): Promise<{
  accountableUserId: string;
  entitlement: PromptEntitlementStatus;
}> {
  const accountabilityRes = await query<RecurringRunAccountabilityRow>(
    `SELECT ts.created_by_user_id,
            t.initiator_user_id
       FROM task_schedules ts
       JOIN tasks t ON t.id = ts.task_id
      WHERE ts.task_id = $1`,
    [taskId]
  );

  if ((accountabilityRes.rowCount ?? 0) === 0) {
    throw new Error("Task is not recurring");
  }

  const accountableUserId =
    accountabilityRes.rows[0].created_by_user_id
    ?? accountabilityRes.rows[0].initiator_user_id;
  if (!accountableUserId) {
    throw new RecurringRunAccountabilityError();
  }

  const entitlement = await getPromptEntitlementStatus(accountableUserId);
  if (!entitlement.allowed) {
    throw new RecurringRunEntitlementError(entitlement);
  }

  return {
    accountableUserId,
    entitlement
  };
}

export async function recordRecurringRunPromptUsageIfRequired(input: {
  taskId: string;
  accountableUserId: string;
  entitlement: PromptEntitlementStatus;
}): Promise<void> {
  if (input.entitlement.mode !== "free") {
    return;
  }

  await recordUserFreeMessageEvent({
    userId: input.accountableUserId,
    taskId: input.taskId,
    taskMessageId: null
  });
}
