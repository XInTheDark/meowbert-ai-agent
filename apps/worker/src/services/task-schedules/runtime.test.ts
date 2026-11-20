import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../queued-messages/scheduled-send.js", () => ({ sendDueScheduledMessages: vi.fn() }));
vi.mock("./shared.js", () => ({
  RECURRING_SCHEDULER_BATCH_SIZE: 80, RECURRING_SCHEDULER_INTERVAL_MS: 5_000,
  assertFiveFieldCron: (value: string) => value, computeNextCronRunAt: () => new Date("2026-12-01"),
  normalizeEnabledTools: () => ({}), normalizeTaskSource: () => "web", prepareRunWithClient: vi.fn(),
  queuePreparedRun: vi.fn(), recurringRunMode: () => "infinite_auto", validateCronCadence: vi.fn()
}));
vi.mock("./recurring-run-entitlement.js", () => ({
  resolveRecurringRunPromptEntitlementInTx: vi.fn().mockResolvedValue({ accountableUserId: "user", entitlement: {} }),
  recordRecurringRunPromptUsageInTx: vi.fn()
}));
import { query, withTransaction } from "../../lib/db.js";
import { prepareRunWithClient, queuePreparedRun } from "./shared.js";
import { recordRecurringRunPromptUsageInTx } from "./recurring-run-entitlement.js";
import { runRecurringSchedulerOnce } from "./runtime.js";

beforeEach(() => vi.clearAllMocks());

it.each(["pending", "scheduled", "infinite"])("does not create or bill a duplicate %s run during startup", async (kind) => {
  for (const [index, selected] of ["pending", "scheduled", "infinite"].entries()) {
    vi.mocked(query).mockResolvedValueOnce({ rows: kind === selected ? [{ task_id: "task" }] : [], rowCount: index } as never);
  }
  const txQuery = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ task_id: "task", workspace_id: "workspace",
    environment_id: "project", source: "web", mode: kind === "scheduled" ? "scheduled" : "infinite",
    schedule_state: "active", repeat_cron: "* * * * *", timezone: "UTC", pending_run: true }] })
    .mockResolvedValueOnce({ rows: [{ status: "starting" }] }).mockResolvedValue({ rows: [] });
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query: txQuery } as never));
  await expect(runRecurringSchedulerOnce()).resolves.toBe(0);
  expect(prepareRunWithClient).not.toHaveBeenCalled();
  expect(queuePreparedRun).not.toHaveBeenCalled();
  expect(recordRecurringRunPromptUsageInTx).not.toHaveBeenCalled();
});
