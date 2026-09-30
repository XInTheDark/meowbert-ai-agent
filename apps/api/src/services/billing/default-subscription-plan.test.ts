import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (cb) => cb({
    query: vi.fn()
  }))
}));

import { query, withTransaction } from "../../lib/db.js";
import {
  createSubscriptionPlan,
  listActiveSubscriptionPlanAgentIdsForUser,
  listSubscriptionPlans,
  replaceUserSubscriptionPlans,
  updateSubscriptionPlan
} from "./subscriptions.js";

const mockedQuery = vi.mocked(query);
const mockedWithTransaction = vi.mocked(withTransaction);

describe("default subscription plan handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockedQuery.mockReset();
    mockedWithTransaction.mockReset();
  });

  it("lists default subscription plan with isDefault = true", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "plan-default",
          name: "[All Users]",
          monthly_token_quota: "0",
          usage_limits_json: [],
          notes: "Default plan applied to all users.",
          is_active: true,
          is_default: true,
          workspace_limit: 5,
          sandbox_pids_limit: null,
          sandbox_memory_mb: 2048,
          sandbox_cpus: "2",
          workspace_storage_mb: null,
          agent_ids_json: ["ops"],
          created_at: "2026-08-30T00:00:00.000Z",
          updated_at: "2026-08-30T00:00:00.000Z"
        },
        {
          id: "plan-pro",
          name: "Pro",
          monthly_token_quota: "100000",
          usage_limits_json: [{ weightedTokens: 100000, durationDays: 30 }],
          notes: null,
          is_active: true,
          is_default: false,
          workspace_limit: 10,
          sandbox_pids_limit: 500,
          sandbox_memory_mb: 4096,
          sandbox_cpus: "4",
          workspace_storage_mb: 10240,
          agent_ids_json: [],
          created_at: "2026-08-30T01:00:00.000Z",
          updated_at: "2026-08-30T01:00:00.000Z"
        }
      ],
      rowCount: 2
    } as never);

    const plans = await listSubscriptionPlans();

    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({
      id: "plan-default",
      name: "[All Users]",
      isDefault: true,
      isActive: true,
      workspaceLimit: 5,
      sandboxMemoryMb: 2048,
      sandboxCpus: 2,
      agentIds: ["ops"]
    });
    expect(plans[1]).toMatchObject({
      id: "plan-pro",
      name: "Pro",
      isDefault: false,
      isActive: true,
      workspaceLimit: 10
    });
  });

  it("prevents creating a plan with the reserved [All Users] name", async () => {
    await expect(createSubscriptionPlan({
      name: "[All Users]",
      usageLimits: []
    })).rejects.toThrow("Cannot create plan with reserved name [All Users]");
  });

  it("prevents deactivating the default subscription plan", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: "plan-default", is_default: true, name: "[All Users]" }],
      rowCount: 1
    } as never);

    await expect(updateSubscriptionPlan({
      planId: "plan-default",
      isActive: false
    })).rejects.toThrow("The default [All Users] plan cannot be deactivated.");
  });

  it("prevents renaming the default subscription plan", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: "plan-default", is_default: true, name: "[All Users]" }],
      rowCount: 1
    } as never);

    await expect(updateSubscriptionPlan({
      planId: "plan-default",
      name: "Custom Name"
    })).rejects.toThrow("The default plan name cannot be changed.");
  });

  it("allows updating resource limits and usage limits on default plan", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: "plan-default", is_default: true, name: "[All Users]" }],
        rowCount: 1
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "plan-default",
            name: "[All Users]",
            monthly_token_quota: "50000",
            usage_limits_json: [{ weightedTokens: 50000, durationDays: 30 }],
            notes: "Updated default",
            is_active: true,
            is_default: true,
            workspace_limit: 3,
            sandbox_pids_limit: null,
            sandbox_memory_mb: 1024,
            sandbox_cpus: null,
            workspace_storage_mb: null,
            agent_ids_json: [],
            created_at: "2026-08-30T00:00:00.000Z",
            updated_at: "2026-08-30T01:00:00.000Z"
          }
        ],
        rowCount: 1
      } as never);

    const updated = await updateSubscriptionPlan({
      planId: "plan-default",
      workspaceLimit: 3,
      sandboxMemoryMb: 1024,
      usageLimits: [{ weightedTokens: 50000, durationDays: 30 }]
    });

    expect(updated).toMatchObject({
      id: "plan-default",
      name: "[All Users]",
      isDefault: true,
      workspaceLimit: 3,
      sandboxMemoryMb: 1024,
      monthlyTokenQuota: 50000
    });
  });

  it("prevents assigning the default plan to individual users", async () => {
    const fakeClient = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [{ id: "plan-default", is_default: true }],
        rowCount: 1
      })
    };
    mockedWithTransaction.mockImplementation(async (cb) => cb(fakeClient as never));

    await expect(replaceUserSubscriptionPlans({
      userId: "user-1",
      planIds: ["plan-default"],
      assignedByUserId: "admin-1"
    })).rejects.toThrow("The default [All Users] plan is applied to all users and cannot be assigned individually.");
  });

  it("includes default plan agents when listing active subscription agent IDs", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { agent_ids_json: ["ops", "code-review"] }
      ],
      rowCount: 1
    } as never);

    const agentIds = await listActiveSubscriptionPlanAgentIdsForUser("user-1");

    expect(agentIds).toEqual(["ops", "code-review"]);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("sp.is_default = true"),
      ["user-1"]
    );
  });
});
