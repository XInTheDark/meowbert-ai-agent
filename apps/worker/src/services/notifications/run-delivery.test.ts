import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withConnection: vi.fn() }));
vi.mock("../agent/notifications.js", () => ({ emitRunNotifications: vi.fn() }));
import { withConnection } from "../../lib/db.js";
import { emitRunNotifications } from "../agent/notifications.js";
import { deliverPendingRun } from "./run-delivery.js";

beforeEach(() => { vi.resetAllMocks(); });

it("resumes after a restart without repeating acknowledged channels", async () => {
  const payload = { taskId: "t", finalResponse: "Done", notificationRequested: true, connectorContextId: "thread" };
  const delivered: string[] = ["web", "push"];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{acquired:true}] };
    if (sql.includes("SELECT payload_json")) return { rows: [{payload_json: payload, delivered_channels: [...delivered]}] };
    if (sql.includes("array_append")) delivered.push(String(params?.[1]));
    return {rows:[]};
  });
  vi.mocked(withConnection).mockImplementation(async (fn) => fn({query} as never));
  let failed = false;
  vi.mocked(emitRunNotifications).mockImplementation(async (_, channel) => {
    if (channel === "discord" && !failed) { failed = true; throw new Error("temporary failure"); }
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await deliverPendingRun("r");
    expect(delivered).toEqual(["web", "push", "telegram", "github", "email"]);
    expect(query.mock.calls.some(([sql]) => sql.includes("completed_at = now()"))).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("next_attempt_at = now()"), ["r", "Error: discord: Error: temporary failure"]);
    vi.mocked(emitRunNotifications).mockClear();
    await deliverPendingRun("r");
    expect(emitRunNotifications).not.toHaveBeenCalledWith(payload, "telegram");
    expect(delivered).toEqual(["web", "push", "telegram", "github", "email", "discord"]);
    expect(emitRunNotifications).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("payload_json = '{}'::jsonb"), ["r"]);
  } finally { warn.mockRestore(); }
});

it("does not send when another worker holds the delivery lock", async () => {
  const query = vi.fn().mockResolvedValue({rows:[{acquired:false}]});
  vi.mocked(withConnection).mockImplementation(async (fn) => fn({query} as never));
  await deliverPendingRun("r");
  expect(emitRunNotifications).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledTimes(1);
});
