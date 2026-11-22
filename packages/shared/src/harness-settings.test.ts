import { describe, expect, it } from "vitest";
import {
  applyHarnessSettingsChange,
  computeKeepAliveDelaySeconds,
  DEFAULT_HARNESS_LIMITS,
  EMPTY_HARNESS_SETTINGS,
  harnessChangeFromUserPatch,
  NO_HARNESS_SETTINGS_CHANGE,
  shouldNotifyForHarnessEvent,
  type HarnessActor,
  type HarnessSettings,
  type HarnessSettingsChange
} from "./harness-settings.js";

const NOW = new Date("2026-11-22T12:00:00.000Z");

function apply(current: HarnessSettings, change: Partial<HarnessSettingsChange>, actor: HarnessActor, taskTimeLimitDeadlineAt: string | null = null) {
  return applyHarnessSettingsChange(current, { ...NO_HARNESS_SETTINGS_CHANGE, ...change }, {
    actor,
    now: NOW,
    limits: DEFAULT_HARNESS_LIMITS,
    taskTimeLimitDeadlineAt
  });
}

function minutesFromNow(minutes: number): string {
  return new Date(NOW.getTime() + minutes * 60_000).toISOString();
}

const userKeepAlive: HarnessSettings = {
  ...EMPTY_HARNESS_SETTINGS,
  keepAliveUntil: { value: minutesFromNow(60), setBy: "user" }
};

describe("applyHarnessSettingsChange", () => {
  it("lets the agent start keep-alive within its cap", () => {
    const result = apply(EMPTY_HARNESS_SETTINGS, { keepAliveMinutes: 30 }, "agent");
    expect(result).toMatchObject({ ok: true, changed: ["keepAliveUntil"] });
    expect(result.ok && result.next.keepAliveUntil).toEqual({ value: minutesFromNow(30), setBy: "agent" });
  });

  it("refuses an agent keep-alive past its cap or the task time limit", () => {
    expect(apply(EMPTY_HARNESS_SETTINGS, { keepAliveMinutes: DEFAULT_HARNESS_LIMITS.maxAgentKeepAliveMinutes + 1 }, "agent").ok).toBe(false);
    expect(apply(EMPTY_HARNESS_SETTINGS, { keepAliveMinutes: 60 }, "agent", minutesFromNow(30)).ok).toBe(false);
  });

  it("never lets the agent end or shorten the user's keep-alive", () => {
    expect(apply(userKeepAlive, { keepAliveMinutes: 0 }, "agent").ok).toBe(false);
    expect(apply(userKeepAlive, { keepAliveMinutes: 10 }, "agent").ok).toBe(false);
  });

  it("keeps an extended user keep-alive the user's", () => {
    const result = apply(userKeepAlive, { keepAliveMinutes: 120 }, "agent");
    expect(result.ok && result.next.keepAliveUntil).toEqual({ value: minutesFromNow(120), setBy: "user" });
  });

  it("lets the agent lower a budget but not raise or remove it", () => {
    const current: HarnessSettings = { ...EMPTY_HARNESS_SETTINGS, tokenBudget: { value: 1_000, setBy: "user" } };
    expect(apply(current, { tokenBudget: 2_000 }, "agent").ok).toBe(false);
    expect(apply(current, { tokenBudget: 0 }, "agent").ok).toBe(false);
    const lowered = apply(current, { tokenBudget: 500 }, "agent");
    expect(lowered.ok && lowered.next.tokenBudget).toEqual({ value: 500, setBy: "user" });
  });

  it("refuses agent changes to settings the user set", () => {
    const current: HarnessSettings = {
      ...EMPTY_HARNESS_SETTINGS,
      stopCheck: { value: { command: "npm test", timeoutSeconds: 600 }, setBy: "user" },
      notify: { value: "never", setBy: "user" }
    };
    expect(apply(current, { stopCheckCommand: "" }, "agent").ok).toBe(false);
    expect(apply(current, { notify: "on_finish" }, "agent").ok).toBe(false);
    expect(apply(current, { stopCheckCommand: "" }, "user")).toMatchObject({ ok: true, changed: ["stopCheck"] });
  });

  it("applies nothing when one key is rejected", () => {
    const result = apply(userKeepAlive, { keepAliveMinutes: 0, sandboxKeepWarmMinutes: 5 }, "agent");
    expect(result.ok).toBe(false);
  });

  it("caps the warm sandbox at the operator limit", () => {
    expect(apply(EMPTY_HARNESS_SETTINGS, { sandboxKeepWarmMinutes: DEFAULT_HARNESS_LIMITS.maxSandboxKeepWarmMinutes + 1 }, "user").ok).toBe(false);
  });
});

describe("harnessChangeFromUserPatch", () => {
  it("clears null keys and leaves missing ones unchanged", () => {
    const current: HarnessSettings = {
      ...EMPTY_HARNESS_SETTINGS,
      stopCheck: { value: { command: "npm test", timeoutSeconds: 600 }, setBy: "agent" },
      tokenBudget: { value: 1_000, setBy: "user" },
      notify: { value: "never", setBy: "user" }
    };
    const result = apply(current, harnessChangeFromUserPatch({ stopCheckCommand: null, notify: null }), "user");
    expect(result.ok && result.next).toEqual({ ...current, stopCheck: null, notify: null });
  });
});

describe("computeKeepAliveDelaySeconds", () => {
  it("doubles with idle cycles up to the backoff cap", () => {
    expect(computeKeepAliveDelaySeconds({ wakeIntervalSeconds: null, idleCycles: 0 })).toBe(60);
    expect(computeKeepAliveDelaySeconds({ wakeIntervalSeconds: null, idleCycles: 2 })).toBe(240);
    expect(computeKeepAliveDelaySeconds({ wakeIntervalSeconds: null, idleCycles: 10 })).toBe(30 * 60);
  });

  it("never waits less than a wake interval longer than the cap", () => {
    expect(computeKeepAliveDelaySeconds({ wakeIntervalSeconds: 3_600, idleCycles: 5 })).toBe(3_600);
  });
});

describe("shouldNotifyForHarnessEvent", () => {
  it("notifies answers by default and failures only for on_failure", () => {
    expect(shouldNotifyForHarnessEvent(null, "finish")).toBe(true);
    expect(shouldNotifyForHarnessEvent(null, "failure")).toBe(false);
    expect(shouldNotifyForHarnessEvent("on_failure", "finish")).toBe(false);
    expect(shouldNotifyForHarnessEvent("on_failure", "failure")).toBe(true);
    expect(shouldNotifyForHarnessEvent("never", "failure")).toBe(false);
  });
});
