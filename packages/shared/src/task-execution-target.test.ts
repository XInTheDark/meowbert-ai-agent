import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_DEVICE_CAPACITY,
  isDeviceReadyForSandbox,
  normalizeTaskExecutionTarget,
  taskExecutionTargetSchema
} from "./task-execution-target.js";

describe("task execution targets", () => {
  it("keeps malformed or missing targets on cloud", () => {
    expect(normalizeTaskExecutionTarget(null)).toEqual({ kind: "cloud" });
    expect(normalizeTaskExecutionTarget({ kind: "local", deviceId: "bad", mode: "sandbox" })).toEqual({ kind: "cloud" });
  });

  it("requires a device and sandbox mode for local targets", () => {
    const deviceId = "00000000-0000-4000-8000-000000000001";
    expect(taskExecutionTargetSchema.parse({ kind: "local", deviceId, mode: "sandbox" })).toEqual({
      kind: "local",
      deviceId,
      mode: "sandbox"
    });
    expect(DEFAULT_LOCAL_DEVICE_CAPACITY).toBe(2);
  });

  it("only reports a device ready when every sandbox prerequisite is present", () => {
    const ready = {
      connected: true,
      storageVerified: true,
      dockerReady: true,
      sandboxImageReady: true,
      executorSupported: true,
      capacityAvailable: true
    };
    expect(isDeviceReadyForSandbox(ready)).toBe(true);
    expect(isDeviceReadyForSandbox({ ...ready, sandboxImageReady: false })).toBe(false);
  });
});
