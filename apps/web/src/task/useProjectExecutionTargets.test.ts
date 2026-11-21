import { describe, expect, it } from "vitest";
import { resolveBridgeToggleTarget, type ProjectExecutionTargetsState } from "./useProjectExecutionTargets";

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";

const baseTargets: ProjectExecutionTargetsState = {
  enabled: true,
  devices: [
    { id: DEVICE_A, name: "MacBook", hostMode: true },
    { id: DEVICE_B, name: "Studio", hostMode: false }
  ],
  fileHost: { kind: "server", backendId: "local" },
  defaultMode: "host",
  currentDeviceId: DEVICE_A
};

describe("resolveBridgeToggleTarget", () => {
  it("switches a cloud task to the current local device with bridge enabled", () => {
    expect(resolveBridgeToggleTarget({
      currentTarget: { kind: "cloud" },
      targets: baseTargets
    })).toEqual({ kind: "local", deviceId: DEVICE_A, mode: "host", bridge: true });
  });

  it("forces sandbox mode when enabling bridge on a restricted task or device without host consent", () => {
    expect(resolveBridgeToggleTarget({
      currentTarget: { kind: "cloud" },
      targets: baseTargets,
      requireSandbox: true
    })).toEqual({ kind: "local", deviceId: DEVICE_A, mode: "sandbox", bridge: true });

    expect(resolveBridgeToggleTarget({
      currentTarget: { kind: "cloud" },
      targets: { ...baseTargets, currentDeviceId: DEVICE_B }
    })).toEqual({ kind: "local", deviceId: DEVICE_B, mode: "sandbox", bridge: true });
  });

  it("returns null when enabling bridge from cloud without any verified local device", () => {
    expect(resolveBridgeToggleTarget({
      currentTarget: { kind: "cloud" },
      targets: { ...baseTargets, devices: [] }
    })).toBeNull();
  });

  it("restores the previous non-bridge target on a server-hosted workspace when turning bridge off", () => {
    expect(resolveBridgeToggleTarget({
      currentTarget: { kind: "local", deviceId: DEVICE_A, mode: "sandbox", bridge: true },
      previousNonBridgeTarget: { kind: "cloud" },
      targets: baseTargets
    })).toEqual({ kind: "cloud" });
  });

  it("keeps a device-hosted task local when turning bridge off", () => {
    expect(resolveBridgeToggleTarget({
      currentTarget: { kind: "local", deviceId: DEVICE_A, mode: "sandbox", bridge: true },
      previousNonBridgeTarget: { kind: "cloud" },
      targets: { ...baseTargets, fileHost: { kind: "device", deviceId: DEVICE_A } }
    })).toEqual({ kind: "local", deviceId: DEVICE_A, mode: "sandbox" });
  });

  it("clears the bridge flag while keeping local mode when no previous target was recorded", () => {
    expect(resolveBridgeToggleTarget({
      currentTarget: { kind: "local", deviceId: DEVICE_A, mode: "host", bridge: true },
      targets: baseTargets
    })).toEqual({ kind: "local", deviceId: DEVICE_A, mode: "host" });
  });
});
