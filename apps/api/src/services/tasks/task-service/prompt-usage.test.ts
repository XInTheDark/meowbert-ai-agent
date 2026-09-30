import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../billing/entitlements.js", () => ({
  getPromptEntitlementStatus: vi.fn(),
  recordPromptUsageIfRequired: vi.fn()
}));

import {
  getPromptEntitlementStatus,
  recordPromptUsageIfRequired
} from "../../billing/entitlements.js";
import {
  ensureTaskPromptEntitlement,
  recordTaskPromptUsage,
  TaskExecutionUserRequiredError,
  TaskPromptEntitlementError
} from "./prompt-usage.js";

const mockedGetPromptEntitlementStatus = vi.mocked(getPromptEntitlementStatus);
const mockedRecordPromptUsageIfRequired = vi.mocked(recordPromptUsageIfRequired);

const allowedEntitlement = {
  mode: "free" as const,
  allowed: true,
  reason: null,
  freeMessageLimit: 10,
  freeMessagesUsed: 0,
  monthlyWeightedTokenLimit: 0,
  monthlyWeightedTokenUsed: 0,
  subscriptionUsageLimitExceeded: false
};

describe("task prompt usage helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetPromptEntitlementStatus.mockResolvedValue(allowedEntitlement);
    mockedRecordPromptUsageIfRequired.mockResolvedValue(undefined);
  });

  it("skips entitlement checks for web-triggered task entrypoints", async () => {
    await expect(
      ensureTaskPromptEntitlement({
        source: "web",
        userId: "user-1"
      })
    ).resolves.toBeNull();

    expect(mockedGetPromptEntitlementStatus).not.toHaveBeenCalled();
  });

  it("requires an accountable user for connector-triggered task entrypoints", async () => {
    await expect(
      ensureTaskPromptEntitlement({
        source: "discord",
        userId: null
      })
    ).rejects.toBeInstanceOf(TaskExecutionUserRequiredError);

    expect(mockedGetPromptEntitlementStatus).not.toHaveBeenCalled();
  });

  it("throws when a connector actor has exhausted prompt entitlement", async () => {
    mockedGetPromptEntitlementStatus.mockResolvedValue({
      ...allowedEntitlement,
      allowed: false,
      reason: "Lifetime free message quota exceeded."
    });

    await expect(
      ensureTaskPromptEntitlement({
        source: "telegram",
        userId: "user-1"
      })
    ).rejects.toBeInstanceOf(TaskPromptEntitlementError);

    expect(mockedGetPromptEntitlementStatus).toHaveBeenCalledWith("user-1");
  });

  it("records connector prompt usage only when entitlement tracking is active", async () => {
    await recordTaskPromptUsage({
      entitlement: allowedEntitlement,
      userId: "user-1",
      taskId: "task-1",
      taskMessageId: "message-1"
    });

    await recordTaskPromptUsage({
      entitlement: null,
      userId: "user-1",
      taskId: "task-2",
      taskMessageId: "message-2"
    });

    expect(mockedRecordPromptUsageIfRequired).toHaveBeenCalledTimes(1);
    expect(mockedRecordPromptUsageIfRequired).toHaveBeenCalledWith({
      userId: "user-1",
      mode: "free",
      taskId: "task-1",
      taskMessageId: "message-1"
    });
  });
});
