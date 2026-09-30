import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, ChevronUp, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { InlineProgressBar } from "../../components/InlineProgressBar";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { BrowserNotificationSettings, WorkspaceNotification } from "../../lib/types";
import {
  readReadWorkspaceNotificationIds,
  readBrowserNotificationSettings,
  writeReadWorkspaceNotificationIds,
  writeBrowserNotificationSettings
} from "../../lib/notificationSettings";
import { syncWebPushSubscription } from "../../lib/webPush";
import { badgeClass, formatDateTime, formatRelative, formatTaskTypeLabel } from "../../lib/utils";

function statusToBadgeStatus(status: string): string {
  if (status === "sent") {
    return "succeeded";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "suppressed" || status === "skipped") {
    return "cancelled";
  }

  return "muted";
}

export function WorkspaceNotificationsPage() {
  const { api, activeWorkspaceId, setFlash } = useWorkspaceApp();
  const { platform, capabilities } = useAppRuntime();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [showRead, setShowRead] = useState(false);
  const [settings, setSettings] = useState<BrowserNotificationSettings>(() => readBrowserNotificationSettings());
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(() => readReadWorkspaceNotificationIds());
  const [permissionState, setPermissionState] = useState<NotificationPermission | "unsupported">("unsupported");
  const unreadNotifications = useMemo(
    () => notifications.filter((item) => !readNotificationIds.has(item.id)),
    [notifications, readNotificationIds]
  );
  const visibleNotifications = useMemo(
    () => (showRead ? notifications : unreadNotifications),
    [notifications, showRead, unreadNotifications]
  );
  const unreadCount = unreadNotifications.length;

  const permissionDescription = useMemo(() => {
    if (permissionState === "unsupported") {
      return capabilities.isDesktop
        ? "Desktop notifications are not available on this device."
        : "Browser notifications are not supported in this browser.";
    }
    if (permissionState === "granted") {
      return capabilities.isDesktop ? "Desktop notifications are enabled." : "Browser notifications are enabled.";
    }
    if (permissionState === "denied") {
      return capabilities.isDesktop
        ? "Desktop notifications are blocked on this device."
        : "Browser notifications are blocked. Enable them in browser site settings.";
    }

    return capabilities.isDesktop
      ? "Desktop notifications are available but not yet enabled."
      : "Browser notifications are available but not yet allowed.";
  }, [capabilities.isDesktop, permissionState]);

  useEffect(() => {
    writeBrowserNotificationSettings(settings);
    if (!capabilities.isDesktop && permissionState === "granted") {
      void syncWebPushSubscription(
        api,
        settings.enablePushNotifications,
        settings.notifyOnBackgroundResponses
      );
    }
  }, [api, capabilities.isDesktop, permissionState, settings]);

  useEffect(() => {
    const syncNotificationState = () => {
      setSettings(readBrowserNotificationSettings());
      setReadNotificationIds(readReadWorkspaceNotificationIds());
      void platform.getNotificationPermission().then((permission) => setPermissionState(permission));
    };

    syncNotificationState();
    window.addEventListener("storage", syncNotificationState);
    document.addEventListener("visibilitychange", syncNotificationState);
    return () => {
      window.removeEventListener("storage", syncNotificationState);
      document.removeEventListener("visibilitychange", syncNotificationState);
    };
  }, [platform]);

  const loadNotifications = useCallback(async () => {
    if (!activeWorkspaceId) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await api.get<{ items: WorkspaceNotification[] }>(
        `/api/workspaces/${activeWorkspaceId}/notifications?limit=150`
      );
      setNotifications(response.items);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    let cancelled = false;

    async function tick(): Promise<void> {
      if (cancelled) {
        return;
      }
      await loadNotifications();
    }

    void tick();
    const intervalId = window.setInterval(() => {
      void tick();
    }, 12_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loadNotifications, refreshNonce]);

  const markNotificationRead = useCallback((notificationId: string) => {
    setReadNotificationIds((current) => {
      if (current.has(notificationId)) {
        return current;
      }
      const next = new Set(current);
      next.add(notificationId);
      writeReadWorkspaceNotificationIds(next);
      return next;
    });
  }, []);

  const markAllUnreadRead = useCallback(() => {
    setReadNotificationIds((current) => {
      let changed = false;
      const next = new Set(current);
      for (const notification of unreadNotifications) {
        if (next.has(notification.id)) {
          continue;
        }
        next.add(notification.id);
        changed = true;
      }
      if (!changed) {
        return current;
      }
      writeReadWorkspaceNotificationIds(next);
      return next;
    });
  }, [unreadNotifications]);

  const openNotificationTask = useCallback((notification: WorkspaceNotification) => {
    markNotificationRead(notification.id);
    navigate(`/app/${activeWorkspaceId}/projects/${notification.environment_id}/tasks/${notification.task_id}`);
  }, [activeWorkspaceId, markNotificationRead, navigate]);

  async function requestNotificationPermission(): Promise<void> {
    if (permissionState === "unsupported") {
      return;
    }

    setIsRequestingPermission(true);
    try {
      const result = await platform.requestNotificationPermission();
      setPermissionState(result);
      if (result === "granted") {
        setFlash({ tone: "success", text: capabilities.isDesktop ? "Desktop notifications enabled." : "Browser notifications enabled." });
        if (!capabilities.isDesktop) {
          void syncWebPushSubscription(
            api,
            settings.enablePushNotifications,
            settings.notifyOnBackgroundResponses
          );
        }
      } else if (result === "denied") {
        setFlash({ tone: "error", text: capabilities.isDesktop ? "Desktop notifications denied." : "Browser notifications denied by the browser." });
      }
    } finally {
      setIsRequestingPermission(false);
    }
  }

  if (!activeWorkspaceId) {
    return (
      <section className="page-content">
        <article className="section-card empty-card">
          <h3>Workspace unavailable</h3>
          <p>Select a workspace to view notifications.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="page-content">
      <article className="section-card">
        <div className="section-head" data-onboarding-id="notifications-header">
          <div>
            <h3>Notifications</h3>
            <p className="muted-text">All task notifications across this workspace.</p>
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setRefreshNonce((value) => value + 1)}
            disabled={isLoading}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setIsOptionsOpen((current) => !current)}
          >
            <SlidersHorizontal size={16} />
            Notification options
            {isOptionsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <span className="muted-text" style={{ fontSize: "0.84rem" }}>
            {unreadCount} unread
          </span>
          <label className="muted-text" style={{ display: "inline-flex", gap: "0.45rem", alignItems: "center", fontSize: "0.84rem" }}>
            <input type="checkbox" checked={showRead} onChange={(event) => setShowRead(event.target.checked)} />
            Show read
          </label>
          {unreadCount > 0 ? (
            <button type="button" className="btn ghost" onClick={markAllUnreadRead}>
              Mark all unread as read
            </button>
          ) : null}
        </div>

        {isOptionsOpen ? (
          <div className="section-card" style={{ marginTop: "0.7rem", background: "var(--surface-muted)" }}>
            <div style={{ display: "grid", gap: "0.8rem" }}>
              <label style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={settings.enablePushNotifications}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      enablePushNotifications: event.target.checked
                    }))
                  }
                />
                <div>
                  <strong>{capabilities.isDesktop ? "Enable desktop notifications" : "Enable browser notifications"}</strong>
                  <p className="muted-text" style={{ margin: 0 }}>
                    {capabilities.isDesktop
                      ? "Receive desktop notifications for task responses and scheduled runs."
                      : "Receive browser notifications for task responses even when the tab is closed."}
                  </p>
                </div>
              </label>

              <label style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={settings.notifyOnBackgroundResponses}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      notifyOnBackgroundResponses: event.target.checked
                    }))
                  }
                  disabled={!settings.enablePushNotifications}
                />
                <div>
                  <strong>Notify for background task responses</strong>
                  <p className="muted-text" style={{ margin: 0 }}>
                    When you leave a task page before it finishes, show a notification when its response arrives.
                  </p>
                </div>
              </label>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem" }}>
                <p className="muted-text" style={{ margin: 0 }}>{permissionDescription}</p>
                {permissionState !== "granted" && permissionState !== "unsupported" ? (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      void requestNotificationPermission();
                    }}
                    disabled={isRequestingPermission}
                  >
                    <Bell size={16} />
                    {isRequestingPermission ? "Requesting..." : "Allow notifications"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {loadError ? <p className="error-text" style={{ marginTop: "0.8rem" }}>{loadError}</p> : null}

        <div className="event-list" style={{ marginTop: "0.9rem" }}>
          {isLoading ? <InlineProgressBar pin="top" /> : null}
          {!isLoading && notifications.length === 0 ? <p className="empty-hint">No notifications yet.</p> : null}
          {!isLoading && notifications.length > 0 && visibleNotifications.length === 0 ? (
            <p className="empty-hint">No unread notifications.</p>
          ) : null}
          {!isLoading && visibleNotifications.map((item) => {
            const isRead = readNotificationIds.has(item.id);
            return (
              <div
                key={item.id}
                className="event-row"
                style={{
                  opacity: isRead ? 0.76 : 1,
                  borderColor: isRead
                    ? "var(--border)"
                    : "color-mix(in srgb, var(--brand) 34%, var(--border))"
                }}
              >
                <header>
                  <strong>{item.task_title ?? "Untitled task"}</strong>
                  <span>{formatRelative(item.created_at)}</span>
                </header>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span className={badgeClass(statusToBadgeStatus(item.status))}>{item.status}</span>
                  <span className="badge muted">{item.channel}</span>
                  <span className="badge muted">{formatTaskTypeLabel(item.task_type)}</span>
                  <span className={`badge ${isRead ? "muted" : "succeeded"}`}>{isRead ? "read" : "unread"}</span>
                  <span className="muted-text" style={{ fontSize: "0.82rem" }}>
                    {item.environment_name}
                  </span>
                </div>
                {item.preview ? (
                  <pre style={{ fontSize: "0.8rem", maxHeight: "120px" }}>{item.preview}</pre>
                ) : null}
                {item.detail ? (
                  <p className="muted-text" style={{ margin: 0, fontSize: "0.82rem" }}>{item.detail}</p>
                ) : null}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                  <span className="muted-text" style={{ fontSize: "0.78rem" }}>
                    {formatDateTime(item.created_at)}
                  </span>
                  <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                    {!isRead ? (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => markNotificationRead(item.id)}
                      >
                        Mark read
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => openNotificationTask(item)}
                    >
                      Open task
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}
