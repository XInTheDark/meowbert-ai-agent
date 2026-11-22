import { describe, expect, it, vi } from "vitest";
import { createSerialGate, waitForSandboxSlot } from "./docker-sandbox-capacity.js";

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
});
