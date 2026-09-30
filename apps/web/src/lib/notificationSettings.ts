import { BrowserNotificationSettings } from "./types";

const BROWSER_NOTIFICATION_SETTINGS_KEY = "meowbert_browser_notification_settings_v1";
const BROWSER_NOTIFICATION_BG_DEFAULT_MIGRATION_KEY = "meowbert_browser_notification_bg_default_v2_applied";
const SEEN_WORKSPACE_NOTIFICATION_IDS_KEY = "meowbert_seen_workspace_notification_ids_v1";
const SEEN_WORKSPACE_NOTIFICATION_LOCK_NAME = "meowbert_workspace_notification_seen";
const READ_WORKSPACE_NOTIFICATION_IDS_KEY = "meowbert_read_workspace_notification_ids_v1";
const MAX_SEEN_NOTIFICATION_IDS = 1500;
const MAX_READ_NOTIFICATION_IDS = 3000;

const DEFAULT_BROWSER_NOTIFICATION_SETTINGS: BrowserNotificationSettings = {
  enablePushNotifications: true,
  notifyOnBackgroundResponses: true
};

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function readBrowserNotificationSettings(): BrowserNotificationSettings {
  const parsed = readJson(BROWSER_NOTIFICATION_SETTINGS_KEY);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_BROWSER_NOTIFICATION_SETTINGS };
  }

  const candidate = parsed as {
    enablePushNotifications?: unknown;
    notifyOnBackgroundResponses?: unknown;
  };

  const next: BrowserNotificationSettings = {
    enablePushNotifications:
      typeof candidate.enablePushNotifications === "boolean"
        ? candidate.enablePushNotifications
        : DEFAULT_BROWSER_NOTIFICATION_SETTINGS.enablePushNotifications,
    notifyOnBackgroundResponses:
      typeof candidate.notifyOnBackgroundResponses === "boolean"
        ? candidate.notifyOnBackgroundResponses
        : DEFAULT_BROWSER_NOTIFICATION_SETTINGS.notifyOnBackgroundResponses
  };

  // Migrate existing users from the previous default (background notifications off).
  try {
    const migrationApplied = localStorage.getItem(BROWSER_NOTIFICATION_BG_DEFAULT_MIGRATION_KEY) === "1";
    if (!migrationApplied) {
      localStorage.setItem(BROWSER_NOTIFICATION_BG_DEFAULT_MIGRATION_KEY, "1");
      if (next.enablePushNotifications && !next.notifyOnBackgroundResponses) {
        const migrated: BrowserNotificationSettings = {
          ...next,
          notifyOnBackgroundResponses: true
        };
        localStorage.setItem(BROWSER_NOTIFICATION_SETTINGS_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch {
    // Fall back to non-migrated settings if localStorage writes fail.
  }

  return next;
}

export function writeBrowserNotificationSettings(settings: BrowserNotificationSettings): void {
  localStorage.setItem(BROWSER_NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
}

export function readSeenWorkspaceNotificationIds(): Set<string> {
  const parsed = readJson(SEEN_WORKSPACE_NOTIFICATION_IDS_KEY);
  if (!Array.isArray(parsed)) {
    return new Set<string>();
  }

  const ids = parsed.filter((value): value is string => typeof value === "string");
  return new Set(ids);
}

export function writeSeenWorkspaceNotificationIds(ids: Set<string>): void {
  const trimmed = Array.from(ids).slice(-MAX_SEEN_NOTIFICATION_IDS);
  localStorage.setItem(SEEN_WORKSPACE_NOTIFICATION_IDS_KEY, JSON.stringify(trimmed));
}

export async function claimSeenWorkspaceNotificationId(notificationId: string): Promise<boolean> {
  const claim = (): boolean => {
    const seenNotificationIds = readSeenWorkspaceNotificationIds();
    if (seenNotificationIds.has(notificationId)) {
      return false;
    }

    seenNotificationIds.add(notificationId);
    writeSeenWorkspaceNotificationIds(seenNotificationIds);
    return true;
  };

  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(
      SEEN_WORKSPACE_NOTIFICATION_LOCK_NAME,
      { mode: "exclusive" },
      claim
    );
  }

  return claim();
}

export function readReadWorkspaceNotificationIds(): Set<string> {
  const parsed = readJson(READ_WORKSPACE_NOTIFICATION_IDS_KEY);
  if (!Array.isArray(parsed)) {
    return new Set<string>();
  }

  const ids = parsed.filter((value): value is string => typeof value === "string");
  return new Set(ids);
}

export function writeReadWorkspaceNotificationIds(ids: Set<string>): void {
  const trimmed = Array.from(ids).slice(-MAX_READ_NOTIFICATION_IDS);
  localStorage.setItem(READ_WORKSPACE_NOTIFICATION_IDS_KEY, JSON.stringify(trimmed));
}

export function markWorkspaceNotificationRead(notificationId: string): Set<string> {
  const next = readReadWorkspaceNotificationIds();
  next.add(notificationId);
  writeReadWorkspaceNotificationIds(next);
  return next;
}
