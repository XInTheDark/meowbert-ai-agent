import { describe, expect, it } from "vitest";
import type { WorkspaceNotification } from "../../../lib/types";
import {
  isTabInactiveLongEnough,
  TAB_INACTIVE_NOTIFICATION_GRACE_MS,
  shouldShowWorkspaceNotification
} from "./useWorkspaceNotificationStream";

function createNotification(overrides: Partial<WorkspaceNotification> = {}): WorkspaceNotification {
  return {
    id: "notification-1",
    task_id: "task-1",
    task_title: "Example task",
    task_status: "succeeded",
    environment_id: "project-1",
    environment_name: "Project",
    task_type: "standard",
    channel: "web",
    status: "sent",
    run_id: "run-1",
    preview: "Done",
    detail: null,
    external_message_id: null,
    created_at: "2026-04-28T07:50:00.000Z",
    ...overrides
  };
}

describe("isTabInactiveLongEnough", () => {
  it("requires the tab to be inactive", () => {
    expect(isTabInactiveLongEnough({
      inactive: true,
      lastActiveAtMs: 1_000,
      nowMs: 1_000 + TAB_INACTIVE_NOTIFICATION_GRACE_MS
    })).toBe(true);
    expect(isTabInactiveLongEnough({
      inactive: false,
      lastActiveAtMs: 1_000,
      nowMs: 1_000 + TAB_INACTIVE_NOTIFICATION_GRACE_MS
    })).toBe(false);
  });
});

describe("shouldShowWorkspaceNotification", () => {
  it("suppresses standard notifications while the tab is active", () => {
    expect(shouldShowWorkspaceNotification({
      notification: createNotification(),
      isTabInactive: false,
      settings: { notifyOnBackgroundResponses: true }
    })).toBe(false);
  });

  it("allows standard notifications after the tab has been inactive", () => {
    expect(shouldShowWorkspaceNotification({
      notification: createNotification(),
      isTabInactive: true,
      settings: { notifyOnBackgroundResponses: true }
    })).toBe(true);
  });

  it("respects the background response setting for standard tasks", () => {
    expect(shouldShowWorkspaceNotification({
      notification: createNotification(),
      isTabInactive: true,
      settings: { notifyOnBackgroundResponses: false }
    })).toBe(false);
  });

  it("allows recurring task updates after the tab has been inactive", () => {
    expect(shouldShowWorkspaceNotification({
      notification: createNotification({ task_type: "scheduled" }),
      isTabInactive: true,
      settings: { notifyOnBackgroundResponses: false }
    })).toBe(true);
  });

  it("requires a sent web notification event", () => {
    expect(shouldShowWorkspaceNotification({
      notification: createNotification({ channel: "email" }),
      isTabInactive: true,
      settings: { notifyOnBackgroundResponses: true }
    })).toBe(false);
    expect(shouldShowWorkspaceNotification({
      notification: createNotification({ status: "suppressed" }),
      isTabInactive: true,
      settings: { notifyOnBackgroundResponses: true }
    })).toBe(false);
  });
});
