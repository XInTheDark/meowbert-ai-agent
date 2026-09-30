import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../admin/admin-settings.js", () => ({ isSuperAdmin: vi.fn(async () => false) }));
vi.mock("./subscriptions.js", () => ({
  getUserByoConfig: vi.fn(async () => ({ enabled: false })),
  getUserFreeMessageUsage: vi.fn(async () => 500),
  getUserMonthlyWeightedTokenUsage: vi.fn(async () => ({ weightedTokensLimit: 0, weightedTokensUsed: 0 })),
  getUserSubscriptionUsageLimits: vi.fn(async () => ({ limits: [] })),
  recordUserFreeMessageEvent: vi.fn(),
  resolveUserFreeMessageLimit: vi.fn()
}));

import { getPromptEntitlementStatus } from "./entitlements.js";
import { resolveUserFreeMessageLimit } from "./subscriptions.js";

beforeEach(() => vi.mocked(resolveUserFreeMessageLimit).mockReset());

describe("getPromptEntitlementStatus", () => {
  it("allows users without a plan to keep sending messages when no limit is set", async () => {
    vi.mocked(resolveUserFreeMessageLimit).mockResolvedValue(null);

    await expect(getPromptEntitlementStatus("user-1")).resolves.toMatchObject({ mode: "free", allowed: true, freeMessageLimit: null });
  });

  it("blocks users who have used up a configured message limit", async () => {
    vi.mocked(resolveUserFreeMessageLimit).mockResolvedValue(500);

    await expect(getPromptEntitlementStatus("user-1")).resolves.toMatchObject({ mode: "free", allowed: false });
  });
});
