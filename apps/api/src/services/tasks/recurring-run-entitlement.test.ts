import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../billing/entitlements.js", () => ({
  getPromptEntitlementStatus: vi.fn()
}));

vi.mock("../billing/subscriptions.js", () => ({
  recordUserFreeMessageEvent: vi.fn()
}));

import { query } from "../../lib/db.js";
import { getPromptEntitlementStatus } from "../billing/entitlements.js";
import { recordUserFreeMessageEvent } from "../billing/subscriptions.js";
import {
  RecurringRunAccountabilityError,
  RecurringRunEntitlementError,
  recordRecurringRunPromptUsageIfRequired,
  resolveRecurringRunPromptEntitlement
} from "./recurring-run-entitlement.js";

const mockedQuery = vi.mocked(query);
const mockedGetPromptEntitlementStatus = vi.mocked(getPromptEntitlementStatus);
const mockedRecordUserFreeMessageEvent = vi.mocked(recordUserFreeMessageEvent);

const allowedEntitlement = {
  mode: "free" as const,
  allowed: true,
  reason: null,
  freeMessageLimit: 10,
  freeMessagesUsed: 2,
  monthlyWeightedTokenLimit: 0,
  monthlyWeightedTokenUsed: 0,
  subscriptionUsageLimitExceeded: false
};

describe("recurring run prompt entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetPromptEntitlementStatus.mockResolvedValue(allowedEntitlement);
    mockedRecordUserFreeMessageEvent.mockResolvedValue(undefined);
  });

  it("uses the schedule creator as the accountable recurring user", async () => {
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      fields: [],
      oid: 0,
      rows: [{
        created_by_user_id: "user-creator",
        initiator_user_id: "user-task"
      }],
      rowCount: 1
    });

    const resolved = await resolveRecurringRunPromptEntitlement("task-1");

    expect(resolved.accountableUserId).toBe("user-creator");
    expect(mockedGetPromptEntitlementStatus).toHaveBeenCalledWith("user-creator");
  });

  it("fails closed when no recurring accountability user is available", async () => {
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      fields: [],
      oid: 0,
      rows: [{
        created_by_user_id: null,
        initiator_user_id: null
      }],
      rowCount: 1
    });

    await expect(resolveRecurringRunPromptEntitlement("task-2")).rejects.toBeInstanceOf(RecurringRunAccountabilityError);
    expect(mockedGetPromptEntitlementStatus).not.toHaveBeenCalled();
  });

  it("rejects recurring runs when the accountable user is out of prompts", async () => {
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      fields: [],
      oid: 0,
      rows: [{
        created_by_user_id: "user-free",
        initiator_user_id: null
      }],
      rowCount: 1
    });
    mockedGetPromptEntitlementStatus.mockResolvedValueOnce({
      ...allowedEntitlement,
      allowed: false,
      reason: "Lifetime free message quota exceeded."
    });

    await expect(resolveRecurringRunPromptEntitlement("task-3")).rejects.toBeInstanceOf(RecurringRunEntitlementError);
  });

  it("records free recurring runs without a task message id", async () => {
    await recordRecurringRunPromptUsageIfRequired({
      taskId: "task-4",
      accountableUserId: "user-free",
      entitlement: allowedEntitlement
    });

    expect(mockedRecordUserFreeMessageEvent).toHaveBeenCalledWith({
      userId: "user-free",
      taskId: "task-4",
      taskMessageId: null
    });
  });
});
