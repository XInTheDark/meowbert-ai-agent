import type { ApiClient } from "./api";

let pendingSubscriptionCleanup: Promise<void> | null = null;

function decodeBase64(base64: string): string {
  if (typeof atob !== "undefined") {
    return atob(base64);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("binary");
  }
  return "";
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = decodeBase64(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isWebPushSupported(): boolean {
  return (
    typeof globalThis !== "undefined"
    && typeof navigator !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in globalThis
    && "Notification" in globalThis
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) {
    return null;
  }

  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.warn("[web-push] Failed to register service worker:", error);
    return null;
  }
}

export async function syncWebPushSubscription(
  api: ApiClient,
  enabled: boolean,
  notifyOnBackgroundResponses: boolean
): Promise<boolean> {
  if (!isWebPushSupported()) {
    return false;
  }

  try {
    await pendingSubscriptionCleanup;
    const registration = await registerServiceWorker();
    if (!registration) {
      return false;
    }

    const existing = await registration.pushManager.getSubscription();
    if (!enabled) {
      if (existing) {
        await existing.unsubscribe();
        try {
          await api.post("/api/notifications/web-push/unsubscribe", {
            endpoint: existing.endpoint
          });
        } catch {
          // Best-effort cleanup on server
        }
      }
      return false;
    }

    if (Notification.permission !== "granted") {
      return false;
    }

    const { publicKey, enabled: serverEnabled } = await api.get<{
      publicKey: string;
      enabled: boolean;
    }>("/api/notifications/web-push/public-key");

    if (!serverEnabled || !publicKey) {
      return false;
    }

    let subscription = existing;
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource
      });
    }

    const subJson = subscription.toJSON();
    if (subJson.endpoint && subJson.keys?.p256dh && subJson.keys?.auth) {
      await api.post("/api/notifications/web-push/subscribe", {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth
        },
        notifyOnBackgroundResponses,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined
      });
      return true;
    }

    return false;
  } catch (error) {
    console.warn("[web-push] Failed to sync push subscription:", error);
    return false;
  }
}

export async function hasWebPushSubscription(): Promise<boolean> {
  if (!isWebPushSupported()) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return Boolean(await registration?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function unsubscribeWebPushSubscription(api: ApiClient): Promise<boolean> {
  if (!isWebPushSupported()) {
    return false;
  }

  const cleanup = (async (): Promise<{ endpoint: string; unsubscribed: boolean } | null> => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      return null;
    }

    const unsubscribed = await subscription.unsubscribe();
    return { endpoint: subscription.endpoint, unsubscribed };
  })();
  const cleanupMarker = cleanup.then(() => undefined, () => undefined);
  pendingSubscriptionCleanup = cleanupMarker;

  try {
    const result = await cleanup;
    if (pendingSubscriptionCleanup === cleanupMarker) {
      pendingSubscriptionCleanup = null;
    }
    if (!result) {
      return false;
    }

    try {
      await api.post("/api/notifications/web-push/unsubscribe", {
        endpoint: result.endpoint
      });
    } catch {
      // Local cleanup still prevents delivery after logout if the session has expired.
    }

    return result.unsubscribed;
  } catch (error) {
    if (pendingSubscriptionCleanup === cleanupMarker) {
      pendingSubscriptionCleanup = null;
    }
    console.warn("[web-push] Failed to unsubscribe push subscription:", error);
    return false;
  }
}
