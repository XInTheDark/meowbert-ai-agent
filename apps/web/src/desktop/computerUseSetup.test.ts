import { describe, expect, it } from "vitest";
import type { DesktopComputerStatus } from "@meowbert/shared";
import { describeComputerUseSetup } from "./computerUseSetup";

function createStatus(overrides: Partial<DesktopComputerStatus>): DesktopComputerStatus {
  return {
    available: true,
    platform: "darwin",
    permissions: {
      accessibility: "granted",
      screenRecording: "granted"
    },
    display: null,
    cursor: null,
    canTakeScreenshot: true,
    canControlComputer: true,
    requiresRestart: false,
    reason: null,
    ...overrides
  };
}

describe("describeComputerUseSetup", () => {
  it("marks the desktop as ready when executor and permissions are available", () => {
    expect(describeComputerUseSetup(createStatus({}))).toEqual({
      ready: true,
      executorAvailable: true,
      missingAccessibility: false,
      missingScreenRecording: false,
      reason: null
    });
  });

  it("flags both missing permission paths when the desktop is connected but blocked", () => {
    expect(describeComputerUseSetup(createStatus({
      canTakeScreenshot: false,
      canControlComputer: false,
      reason: "Screen recording permission is required before the desktop can send screenshots."
    }))).toEqual({
      ready: false,
      executorAvailable: true,
      missingAccessibility: true,
      missingScreenRecording: true,
      reason: "Screen recording permission is required before the desktop can send screenshots."
    });
  });

  it("treats a missing executor as not ready", () => {
    expect(describeComputerUseSetup(createStatus({
      available: false,
      canTakeScreenshot: false,
      canControlComputer: false,
      reason: "Computer use is only available in Meowbert Desktop."
    }))).toEqual({
      ready: false,
      executorAvailable: false,
      missingAccessibility: true,
      missingScreenRecording: true,
      reason: "Computer use is only available in Meowbert Desktop."
    });
  });
});
