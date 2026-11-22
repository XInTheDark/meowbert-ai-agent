import { describe, expect, it } from "vitest";
import { DEFAULT_HARNESS_LIMITS, NO_HARNESS_SETTINGS_CHANGE, type HarnessSettingsChange } from "./harness-settings.js";
import { updateHarnessSettingsInTx, type HarnessSettingsDb } from "./harness-settings-store.js";

const NOW = new Date("2026-11-22T12:00:00.000Z");

// A root task with a Timed schedule that has a user-set wake interval.
function timedTaskRow(scheduleState: "active" | "paused") {
  return {
    workspace_id: "ws-1",
    environment_id: "env-1",
    default_timezone: "UTC",
    time_limit_deadline_at: null,
    read_only: false,
    parent_task_id: null,
    workflow_parent_task_id: null,
    workflow_type: null,
    spent_tokens: "0",
    schedule_mode: "infinite",
    schedule_state: scheduleState,
    run_timeout_seconds: 3600,
    run_deadline_at: scheduleState === "active" ? "2026-11-22T13:00:00.000Z" : null,
    keep_alive_set_by: "agent",
    wake_interval_seconds: 300,
    wake_interval_set_by: "user",
    stop_check_command: null,
    stop_check_timeout_seconds: null,
    stop_check_set_by: null,
    token_budget: null,
    token_budget_set_by: null,
    notify: null,
    notify_set_by: null,
    sandbox_keep_warm_minutes: null,
    sandbox_keep_warm_set_by: null
  };
}

function fakeDb(row: object): HarnessSettingsDb & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    async query<T extends object>(text: string) {
      if (text.includes("FROM tasks t")) return { rows: [row as T], rowCount: 1 };
      writes.push(text);
      return { rows: [], rowCount: 1 };
    }
  };
}

function update(db: HarnessSettingsDb, change: Partial<HarnessSettingsChange>, actor: "user" | "agent") {
  return updateHarnessSettingsInTx(db, {
    taskId: "task-1",
    actor,
    actorUserId: "user-1",
    change: { ...NO_HARNESS_SETTINGS_CHANGE, ...change },
    limits: DEFAULT_HARNESS_LIMITS,
    now: NOW
  });
}

describe("updateHarnessSettingsInTx", () => {
  it("ends keep-alive while a wake interval is set, and keeps the stored interval", async () => {
    const db = fakeDb(timedTaskRow("active"));
    const { settings } = await update(db, { keepAliveMinutes: 0 }, "agent");
    expect(settings.keepAliveUntil).toBeNull();
    expect(db.writes.some((text) => text.includes("schedule_state = 'paused'"))).toBe(true);
    expect(db.writes.some((text) => text.includes("wake_interval_seconds = $2"))).toBe(false);
  });

  it("accepts other changes after keep-alive has stopped", async () => {
    const db = fakeDb(timedTaskRow("paused"));
    const { settings } = await update(db, { tokenBudget: 5_000 }, "user");
    expect(settings.tokenBudget).toEqual({ value: 5_000, setBy: "user" });
    expect(settings.wakeIntervalSeconds).toBeNull();
  });

  it("refuses a new wake interval while keep-alive is off", async () => {
    await expect(update(fakeDb(timedTaskRow("paused")), { wakeIntervalSeconds: 600 }, "user"))
      .rejects.toThrow("keep-alive");
  });
});
