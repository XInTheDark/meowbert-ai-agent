import { describe, expect, it } from "vitest";
import { buildDesktopComputerUnavailableMessage } from "./desktop-computer-status.js";

interface DesktopComputerStatusLike {
  available: boolean;
  platform: string;
  permissions: {
    accessibility: string;
    screenRecording: string;
  };
  display: null;
  cursor: null;
  canTakeScreenshot: boolean;
  canControlComputer: boolean;
  requiresRestart: boolean;
  reason: string | null;
}

function createStatus(overrides: Partial<DesktopComputerStatusLike>): DesktopComputerStatusLike {
  return {
    available: false,
    platform: "darwin",
    permissions: {
      accessibility: "prompt",
      screenRecording: "prompt"
    },
    display: null,
    cursor: null,
    canTakeScreenshot: false,
    canControlComputer: false,
    requiresRestart: false,
    reason: null,
    ...overrides
  };
}

describe("buildDesktopComputerUnavailableMessage", () => {
  it("reports a connected but unready desktop distinctly from a missing executor", () => {
    expect(buildDesktopComputerUnavailableMessage(createStatus({
      available: true,
      reason: "Screen recording permission is required before the desktop can send screenshots."
    }))).toBe(
      "Computer use was requested, and a Meowbert Desktop executor is connected, but it is not ready yet. Screen recording permission is required before the desktop can send screenshots."
    );
  });

  it("falls back to the disconnected wording when no usable status is present", () => {
    expect(buildDesktopComputerUnavailableMessage(null)).toBe(
      "Computer use was requested, but no ready Meowbert Desktop executor is connected. The desktop app may be offline or missing required permissions."
    );
  });
});
