import type { QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  recordRecurringRunPromptUsageInTx,
  resolveRecurringRunPromptEntitlementInTx
} from "./recurring-run-entitlement.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

function createClient(handler: (sql: string, params: unknown[]) => QueryResult<any> | Promise<QueryResult<any>>) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params))
  };
}

describe("worker recurring run prompt entitlement", () => {
  it("pauses schedules that have no accountable user", async () => {
    const client = createClient((sql) => {
      if (sql.includes("FROM task_schedules ts") && sql.includes("created_by_user_id")) {
        return buildRowsResult([{
          created_by_user_id: null,
          initiator_user_id: null
        }]);
      }
      if (sql.includes("UPDATE task_schedules")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });

    const resolved = await resolveRecurringRunPromptEntitlementInTx(client as never, "task-1");

    expect(resolved).toBeNull();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET schedule_state = 'paused'"),
      ["task-1"]
    );
  });

  it("allows recurring runs for free-tier users who still have prompts", async () => {
    const client = createClient((sql) => {
      if (sql.includes("FROM task_schedules ts") && sql.includes("created_by_user_id")) {
        return buildRowsResult([{
          created_by_user_id: "user-1",
          initiator_user_id: null
        }]);
      }
      if (sql.includes("SELECT is_super_admin, byo_enabled, message_rate_limit")) {
        return buildRowsResult([{
          is_super_admin: false,
          byo_enabled: false,
          message_rate_limit: null
        }]);
      }
      if (sql.includes("FROM user_free_message_events")) {
        return buildRowsResult([{ count: "2" }]);
      }
      if (sql.includes("FROM user_token_usage_events")) {
        return buildRowsResult([{ total: "0" }]);
      }
      if (sql.includes("FROM subscription_plans")) {
        return buildRowsResult([{ total: "0" }]);
      }
      if (sql.includes("FROM platform_settings")) {
        return buildRowsResult([{ default_free_message_limit: 10 }]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });

    const resolved = await resolveRecurringRunPromptEntitlementInTx(client as never, "task-2");

    expect(resolved).toMatchObject({
      accountableUserId: "user-1",
      entitlement: {
        mode: "free",
        allowed: true
      }
    });
  });

  it("records free recurring runs without a task message id", async () => {
    const client = createClient((sql) => {
      if (sql.includes("INSERT INTO user_free_message_events")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });

    await recordRecurringRunPromptUsageInTx({
      client: client as never,
      taskId: "task-3",
      accountableUserId: "user-1",
      entitlement: {
        mode: "free",
        allowed: true,
        reason: null,
        freeMessageLimit: 10,
        freeMessagesUsed: 0,
        monthlyWeightedTokenLimit: 0,
        monthlyWeightedTokenUsed: 0,
        subscriptionUsageLimitExceeded: false
      }
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_free_message_events"),
      ["user-1", "task-3"]
    );
  });
});
