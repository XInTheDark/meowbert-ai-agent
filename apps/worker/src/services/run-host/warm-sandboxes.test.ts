import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 1 }))
}));

import type { DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";
import { query } from "../../lib/db.js";
import { adoptWarmSandbox, parkWarmSandbox, type WarmSandboxFingerprint } from "./warm-sandboxes.js";

const mockedQuery = vi.mocked(query);
const fingerprint: WarmSandboxFingerprint = { actorUserId: "user-1", networkEnabled: true, runAsRoot: false, readOnly: false };

function fakeSandbox(readCrashReport: () => Promise<unknown>) {
  return {
    id: "container-1",
    stop: vi.fn(async () => undefined),
    readCrashReport: vi.fn(readCrashReport)
  } as unknown as DockerSandboxHandle & { stop: ReturnType<typeof vi.fn> };
}

async function park(sandbox: DockerSandboxHandle, release = vi.fn(async () => undefined)) {
  await parkWarmSandbox({ taskId: "task-1", userId: "user-1", runtimeLimit: null, sandbox, fingerprint, minutes: 5, release });
  return release;
}

describe("warm sandboxes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
  });

  it("hands a healthy sandbox to the task's next run and marks it adopted", async () => {
    const sandbox = fakeSandbox(async () => null);
    const release = await park(sandbox);

    await expect(adoptWarmSandbox({ taskId: "task-1", runId: "run-2", fingerprint })).resolves.toBe(sandbox);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("adopted_by_run_id = $2"), ["container-1", "run-2"]);
    expect(sandbox.stop).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("never gives one user's sandbox to another user's run", async () => {
    const sandbox = fakeSandbox(async () => null);
    const release = await park(sandbox);

    await expect(adoptWarmSandbox({ taskId: "task-1", runId: "run-2", fingerprint: { ...fingerprint, actorUserId: "user-2" } }))
      .resolves.toBeNull();
    expect(sandbox.stop).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("discards a sandbox whose health can't be read", async () => {
    const sandbox = fakeSandbox(async () => {
      throw new Error("docker timeout");
    });
    await park(sandbox);

    await expect(adoptWarmSandbox({ taskId: "task-1", runId: "run-2", fingerprint })).resolves.toBeNull();
    expect(sandbox.stop).toHaveBeenCalled();
  });
});
