import { describe, expect, it, vi } from "vitest";
import {
  assertShellSessionCapacity,
  claimSandboxSlot,
  createSerialGate,
  isSandboxCapacityError,
  resolveShellSessionLimit,
  waitForSandboxSlot
} from "./docker-sandbox-capacity.js";

function fakeClock() {
  let nowMs = 0;
  return {
    now: () => nowMs,
    sleep: vi.fn(async (ms: number) => {
      nowMs += ms;
    })
  };
}

describe("waitForSandboxSlot", () => {
  it("starts right away while the host is under the limit", async () => {
    const clock = fakeClock();
    const onWaiting = vi.fn();

    await expect(waitForSandboxSlot({ limit: 16, countActive: async () => 15, onWaiting, ...clock }))
      .resolves.toEqual({ waitedMs: 0 });
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("waits at the limit until a sandbox goes away", async () => {
    const clock = fakeClock();
    const counts = [16, 16, 15];
    const onWaiting = vi.fn();

    const result = await waitForSandboxSlot({
      limit: 16,
      countActive: async () => counts.shift() ?? 0,
      onWaiting,
      pollIntervalMs: 1_000,
      ...clock
    });

    expect(onWaiting).toHaveBeenCalledWith(16);
    expect(result).toEqual({ waitedMs: 2_000 });
  });

  it("stops a warm sandbox instead of waiting when one can be freed", async () => {
    const clock = fakeClock();
    let active = 16;
    const relieve = vi.fn(async () => {
      active -= 1;
      return true;
    });
    const onWaiting = vi.fn();

    await expect(waitForSandboxSlot({ limit: 16, countActive: async () => active, relieve, onWaiting, ...clock }))
      .resolves.toEqual({ waitedMs: 0 });
    expect(relieve).toHaveBeenCalledTimes(1);
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("waits as usual when nothing can be freed", async () => {
    const clock = fakeClock();
    const counts = [16, 15];
    const relieve = vi.fn(async () => false);

    const result = await waitForSandboxSlot({
      limit: 16,
      countActive: async () => counts.shift() ?? 0,
      relieve,
      pollIntervalMs: 1_000,
      ...clock
    });

    expect(relieve).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ waitedMs: 1_000 });
  });

  it("fails the run once the host stays full past the timeout", async () => {
    const clock = fakeClock();

    await expect(waitForSandboxSlot({
      limit: 2,
      countActive: async () => 2,
      pollIntervalMs: 1_000,
      timeoutMs: 5_000,
      ...clock
    })).rejects.toThrow("maxRunningContainers");
  });

  it("names the full-host failure so callers can tell it apart", async () => {
    const error = await waitForSandboxSlot({ limit: 1, countActive: async () => 1, timeoutMs: 0, ...fakeClock() })
      .catch((caught: unknown) => caught);

    expect(isSandboxCapacityError(error)).toBe(true);
    expect(isSandboxCapacityError(new Error("Timed out while creating sandbox container"))).toBe(false);
  });

  it("gives up as soon as the run that needs the sandbox is interrupted", async () => {
    const controller = new AbortController();
    const waiting = waitForSandboxSlot({
      limit: 1,
      countActive: async () => 1,
      onWaiting: () => {
        setTimeout(() => controller.abort(new Error("TASK_CANCELLED")), 5);
      },
      pollIntervalMs: 60_000,
      signal: controller.signal
    });

    await expect(waiting).rejects.toThrow("TASK_CANCELLED");
  });
});

describe("createSerialGate", () => {
  it("runs one callback at a time and keeps going after a failure", async () => {
    const gate = createSerialGate();
    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = gate(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first:end");
      throw new Error("boom");
    });
    const second = gate(async () => {
      order.push("second");
      return "ok";
    });

    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    releaseFirst();

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("lets a queued caller leave when it is interrupted, without ever running its callback", async () => {
    const gate = createSerialGate();
    let releaseFirst!: () => void;
    const first = gate(() => new Promise<string>((resolve) => {
      releaseFirst = () => resolve("first");
    }));
    const controller = new AbortController();
    const queuedCallback = vi.fn(async () => "queued");
    const queued = gate(queuedCallback, controller.signal);

    controller.abort(new Error("TASK_CANCELLED"));
    await expect(queued).rejects.toThrow("TASK_CANCELLED");

    releaseFirst();
    await expect(first).resolves.toBe("first");
    await expect(gate(async () => "next")).resolves.toBe("next");
    expect(queuedCallback).not.toHaveBeenCalled();
  });
});

describe("resolveShellSessionLimit", () => {
  it("reserves task headroom below maxRunningContainers", () => {
    expect(resolveShellSessionLimit(64)).toBe(48);
    expect(resolveShellSessionLimit(32)).toBe(24);
    expect(resolveShellSessionLimit(16)).toBe(12);
    expect(resolveShellSessionLimit(4)).toBe(3);
    expect(resolveShellSessionLimit(1)).toBe(1);
  });
});

describe("assertShellSessionCapacity", () => {
  it("rejects persistent shells once they reach their cap, leaving task slots free", async () => {
    await expect(assertShellSessionCapacity({
      limit: 64,
      countActive: async () => 48,
      countShellSessions: async () => 48
    })).rejects.toThrow(/48 persistent shell slots.*16 of 64/);
  });

  it("evicts a warm sandbox when total slots are full but shell slots have room", async () => {
    let active = 64;
    const relieve = vi.fn(async () => {
      active -= 1;
      return true;
    });

    await expect(assertShellSessionCapacity({
      limit: 64,
      countActive: async () => active,
      countShellSessions: async () => 10,
      relieve
    })).resolves.toBeUndefined();
    expect(relieve).toHaveBeenCalledTimes(1);
  });

  it("fails fast instead of waiting when all host slots stay full", async () => {
    await expect(assertShellSessionCapacity({
      limit: 64,
      countActive: async () => 64,
      countShellSessions: async () => 10,
      relieve: async () => false
    })).rejects.toThrow(/all 64 sandbox slots/);
  });
});

describe("claimSandboxSlot", () => {
  it("releases the gate while sleeping so another caller is not blocked behind a waiting run", async () => {
    const gate = createSerialGate();
    let active = 4;
    let releaseSleep!: () => void;
    const waiting = claimSandboxSlot({
      gate,
      limit: 4,
      countActive: async () => active,
      claim: async () => {
        active += 1;
        return "claimed-task";
      },
      sleep: () => new Promise<void>((resolve) => {
        releaseSleep = resolve;
      }),
      now: () => 0
    });

    await vi.waitFor(() => expect(releaseSleep).toBeTypeOf("function"));

    // While the task run is sleeping between polls, another caller can enter the gate immediately.
    await expect(gate(async () => assertShellSessionCapacity({
      limit: 4,
      countActive: async () => active,
      countShellSessions: async () => 3
    }))).rejects.toThrow(/3 persistent shell slots/);

    active = 3;
    releaseSleep();
    await expect(waiting).resolves.toEqual({ value: "claimed-task", waitedMs: 0 });
  });
});
