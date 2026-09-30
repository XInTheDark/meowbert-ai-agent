import { useEffect, useRef, type MutableRefObject } from "react";
import type { ApiClient } from "../../../lib/api";
import { apiBaseUrl } from "../../../lib/api";
import {
  claimSeenWorkspaceNotificationId,
  markWorkspaceNotificationRead,
  readBrowserNotificationSettings,
} from "../../../lib/notificationSettings";
import { hasWebPushSubscription } from "../../../lib/webPush";
import type { PlatformNotificationPermission } from "../../../desktop/platform";
import type { WorkspaceNotification } from "../../../lib/types";
import { formatTaskTypeLabel } from "../../../lib/utils";

export const TAB_INACTIVE_NOTIFICATION_GRACE_MS = 0;

interface NotificationPlatform {
  getNotificationPermission: () => Promise<PlatformNotificationPermission>;
  showNotification: (input: {
    title: string;
    body: string;
    tag: string;
    route: string;
  }) => Promise<void>;
}

interface UseWorkspaceNotificationStreamInput {
  activeWorkspaceId: string;
  api: ApiClient;
  isDesktop: boolean;
  platform: NotificationPlatform;
  token: string;
}

interface ScopedAccessTicket {
  ticket: string;
  expiresAt: string;
}

interface TabActivityState {
  inactive: boolean;
  lastActiveAtMs: number;
}

function isRecurringNotification(notification: WorkspaceNotification): boolean {
  return notification.task_type === "scheduled"
    || notification.task_type === "infinite"
    || notification.task_type === "timed";
}

export function isTabInactiveLongEnough(input: {
  inactive: boolean;
  lastActiveAtMs: number;
  nowMs: number;
}): boolean {
  return input.inactive && input.nowMs - input.lastActiveAtMs >= TAB_INACTIVE_NOTIFICATION_GRACE_MS;
}

export function shouldShowWorkspaceNotification(input: {
  notification: WorkspaceNotification;
  isTabInactive: boolean;
  settings: {
    notifyOnBackgroundResponses: boolean;
  };
}): boolean {
  if (!input.isTabInactive) {
    return false;
  }
  if (input.notification.channel !== "web" || input.notification.status !== "sent") {
    return false;
  }

  return isRecurringNotification(input.notification) || input.settings.notifyOnBackgroundResponses;
}

function buildWorkspaceNotificationStreamUrl(workspaceId: string, ticket: string): string {
  const url = new URL(`${apiBaseUrl()}/api/workspaces/${workspaceId}/notifications/stream`);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

function useTabActivityState(): MutableRefObject<TabActivityState> {
  const activityRef = useRef<TabActivityState>({
    inactive: typeof document === "undefined" ? false : document.hidden || !document.hasFocus(),
    lastActiveAtMs: Date.now()
  });

  useEffect(() => {
    const markActiveIfFocused = () => {
      if (document.hidden || !document.hasFocus()) {
        activityRef.current = {
          ...activityRef.current,
          inactive: true
        };
        return;
      }

      activityRef.current = {
        inactive: false,
        lastActiveAtMs: Date.now()
      };
    };

    const markInactive = () => {
      activityRef.current = {
        ...activityRef.current,
        inactive: true
      };
    };

    document.addEventListener("visibilitychange", markActiveIfFocused);
    window.addEventListener("focus", markActiveIfFocused);
    window.addEventListener("blur", markInactive);
    window.addEventListener("pointerdown", markActiveIfFocused);
    window.addEventListener("keydown", markActiveIfFocused);

    return () => {
      document.removeEventListener("visibilitychange", markActiveIfFocused);
      window.removeEventListener("focus", markActiveIfFocused);
      window.removeEventListener("blur", markInactive);
      window.removeEventListener("pointerdown", markActiveIfFocused);
      window.removeEventListener("keydown", markActiveIfFocused);
    };
  }, []);

  return activityRef;
}

export function useWorkspaceNotificationStream(input: UseWorkspaceNotificationStreamInput): void {
  const activityRef = useTabActivityState();

  useEffect(() => {
    if (!input.activeWorkspaceId || !input.token || typeof EventSource === "undefined") {
      return;
    }

    let disposed = false;
    let source: EventSource | null = null;
    let reconnectDelayMs = 1_000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) {
        return;
      }

      const delay = reconnectDelayMs;
      reconnectDelayMs = Math.min(60_000, reconnectDelayMs * 2);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const showNotificationIfNeeded = async (notification: WorkspaceNotification): Promise<void> => {
      if (!await claimSeenWorkspaceNotificationId(notification.id)) {
        return;
      }

      const settings = readBrowserNotificationSettings();
      const permission = await input.platform.getNotificationPermission();
      const canPush = settings.enablePushNotifications && permission === "granted";
      if (!canPush) {
        return;
      }

      if (!input.isDesktop && await hasWebPushSubscription()) {
        return;
      }

      if (!shouldShowWorkspaceNotification({
        notification,
        isTabInactive: isTabInactiveLongEnough({
          ...activityRef.current,
          nowMs: Date.now()
        }),
        settings
      })) {
        return;
      }

      const titlePrefix = isRecurringNotification(notification) ? "Scheduled task update" : "Task response";
      const title = `${titlePrefix}: ${notification.task_title ?? "Untitled task"}`;
      const body =
        notification.preview && notification.preview.trim().length > 0
          ? notification.preview
          : `${notification.environment_name} · ${formatTaskTypeLabel(notification.task_type)}`;

      await input.platform.showNotification({
        title,
        body,
        tag: `meowbert-task-${notification.task_id}-event-${notification.id}`,
        route: `/app/${input.activeWorkspaceId}/projects/${notification.environment_id}/tasks/${notification.task_id}`
      });
      markWorkspaceNotificationRead(notification.id);
    };

    const connect = async () => {
      try {
        const ticket = await input.api.post<ScopedAccessTicket>(
          `/api/workspaces/${input.activeWorkspaceId}/notifications/stream-ticket`
        );
        if (disposed) {
          return;
        }

        const nextSource = new EventSource(buildWorkspaceNotificationStreamUrl(input.activeWorkspaceId, ticket.ticket), {
          withCredentials: false
        });
        source = nextSource;
        nextSource.addEventListener("open", () => {
          if (disposed || source !== nextSource) {
            return;
          }
          reconnectDelayMs = 1_000;
        });
        nextSource.addEventListener("notification", (event) => {
          try {
            const notification = JSON.parse((event as MessageEvent).data) as WorkspaceNotification;
            void showNotificationIfNeeded(notification);
          } catch {
            // Ignore malformed notification payloads.
          }
        });
        nextSource.addEventListener("error", () => {
          if (source !== nextSource) {
            return;
          }
          nextSource.close();
          source = null;
          scheduleReconnect();
        });
      } catch {
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      source?.close();
      source = null;
    };
  }, [activityRef, input.activeWorkspaceId, input.api, input.platform, input.token]);
}
