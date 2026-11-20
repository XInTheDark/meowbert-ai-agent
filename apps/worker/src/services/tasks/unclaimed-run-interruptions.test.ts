import { beforeEach, expect, it, vi } from "vitest";
import type { TaskExecutionJob } from "@meowbert/shared";

vi.mock("../../lib/db.js", () => ({ withTransaction: vi.fn() }));
vi.mock("../run-host/run-cancellation.js", () => ({ handleCancelledRun: vi.fn() }));
vi.mock("../agent-swarm/run-finalize.js", () => ({ finishFailedLaneRun: vi.fn() }));
import { withTransaction } from "../../lib/db.js";
import { handleCancelledRun } from "../run-host/run-cancellation.js";
import { finishFailedLaneRun } from "../agent-swarm/run-finalize.js";
import { settleUnclaimedRunInterruptionsOnce } from "./unclaimed-run-interruptions.js";

beforeEach(() => vi.clearAllMocks());

it.each(["cloud", "local"] as const)("settles unclaimed %s interruptions without admitting an executor", async (kind) => {
  const job = { taskId: "task", runId: "run", workspaceId: "workspace", environmentId: "project", triggerSource: "web",
    executionTarget: kind === "cloud" ? { kind } : { kind, deviceId: "device", mode: "sandbox" } } as TaskExecutionJob;
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ run_id: job.runId, payload_json: job }] }).mockResolvedValue({ rows: [] });
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query } as never));
  await expect(settleUnclaimedRunInterruptionsOnce()).resolves.toBe(1);
  expect(handleCancelledRun).toHaveBeenCalledWith(job);
  expect(finishFailedLaneRun).toHaveBeenCalledWith(job, "cancelled", true);
  expect(query.mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(handleCancelledRun).mock.invocationCallOrder[0]);
});

it("does not settle runs held by an executor or superseded by a continuation", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query } as never));
  await expect(settleUnclaimedRunInterruptionsOnce()).resolves.toBe(0);
  expect(handleCancelledRun).not.toHaveBeenCalled();
  expect(finishFailedLaneRun).not.toHaveBeenCalled();
});
