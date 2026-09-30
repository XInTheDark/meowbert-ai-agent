import { describe, expect, it } from "vitest";
import {
  buildDefaultTaskSchedulerSettings,
  compareTaskRunDispatchClasses,
  normalizeTaskSchedulerSettings,
  resolveBullMqPriorityForDispatchClass,
  resolveEffectiveTaskRunDispatchClass,
  resolveTaskRunDispatchClass
} from "./task-scheduler.js";

describe("task scheduler settings", () => {
  it("fills defaults when the persisted value is missing or invalid", () => {
    const defaults = buildDefaultTaskSchedulerSettings({
      defaultEnvironmentConcurrency: 4,
      maxWorkspaceConcurrency: 20
    });

    expect(normalizeTaskSchedulerSettings(null, defaults)).toEqual(defaults);
    expect(normalizeTaskSchedulerSettings({ backgroundAgingMinutes: -1 }, defaults)).toEqual(defaults);
  });

  it("merges valid persisted overrides with defaults", () => {
    const defaults = buildDefaultTaskSchedulerSettings({
      defaultEnvironmentConcurrency: 4,
      maxWorkspaceConcurrency: 20
    });

    expect(normalizeTaskSchedulerSettings({ maxQueuedAheadPerWorkspace: 3 }, defaults)).toEqual({
      ...defaults,
      maxQueuedAheadPerWorkspace: 3
    });
  });
});

describe("dispatch class resolution", () => {
  it("upgrades explicit super-admin runs to admin_interactive", () => {
    expect(resolveTaskRunDispatchClass({ category: "new", priorityActorIsSuperAdmin: true })).toBe("admin_interactive");
    expect(resolveTaskRunDispatchClass({ category: "followup", priorityActorIsSuperAdmin: true })).toBe("admin_interactive");
  });

  it("keeps background runs as background", () => {
    expect(resolveTaskRunDispatchClass({ category: "background", priorityActorIsSuperAdmin: true })).toBe("background");
  });

  it("ages background runs into interactive_new", () => {
    expect(resolveEffectiveTaskRunDispatchClass({
      dispatchClass: "background",
      queuedAt: "2026-03-21T00:00:00.000Z",
      backgroundAgingMinutes: 15,
      now: new Date("2026-03-21T00:16:00.000Z")
    })).toBe("interactive_new");
  });

  it("orders dispatch classes from most to least urgent", () => {
    expect(compareTaskRunDispatchClasses("admin_interactive", "interactive_followup")).toBeLessThan(0);
    expect(compareTaskRunDispatchClasses("interactive_followup", "interactive_new")).toBeLessThan(0);
    expect(compareTaskRunDispatchClasses("interactive_new", "background")).toBeLessThan(0);
    expect(resolveBullMqPriorityForDispatchClass("admin_interactive")).toBe(1);
    expect(resolveBullMqPriorityForDispatchClass("background")).toBe(4);
  });
});
