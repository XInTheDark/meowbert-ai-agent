import { beforeEach, describe, expect, it, vi } from "vitest";

const adminSettingsMock = vi.hoisted(() => ({
  isSuperAdmin: vi.fn(),
  getAdminSettings: vi.fn()
}));

const subscriptionsMock = vi.hoisted(() => ({
  listActiveSubscriptionPlanAgentIdsForUser: vi.fn()
}));

vi.mock("../admin/admin-settings.js", () => adminSettingsMock);

vi.mock("../billing/subscriptions.js", () => subscriptionsMock);

import { getVisiblePlatformAgentsForUser } from "./platform-agents.js";

describe("platform agent visibility", () => {
  beforeEach(() => {
    adminSettingsMock.isSuperAdmin.mockResolvedValue(false);
    subscriptionsMock.listActiveSubscriptionPlanAgentIdsForUser.mockResolvedValue([]);
    adminSettingsMock.getAdminSettings.mockResolvedValue({
      agentPresets: [
        {
          id: "default",
          name: "Default",
          description: "Default preset",
          requiresSuperAdmin: false,
          payload: {}
        },
        {
          id: "ops",
          name: "Ops",
          description: "Super admin preset",
          requiresSuperAdmin: true,
          payload: {}
        }
      ]
    });
  });

  it("shows plan-granted super-admin agents to non-super-admin users", async () => {
    subscriptionsMock.listActiveSubscriptionPlanAgentIdsForUser.mockResolvedValue(["ops"]);

    const result = await getVisiblePlatformAgentsForUser("user-1");

    expect(result.actorIsSuperAdmin).toBe(false);
    expect(result.presets.map((preset) => preset.id)).toEqual(["default", "ops"]);
    expect(result.defaultAgentId).toBe("default");
  });

  it("keeps ungranted super-admin agents hidden", async () => {
    const result = await getVisiblePlatformAgentsForUser("user-1");

    expect(result.presets.map((preset) => preset.id)).toEqual(["default"]);
  });
});
