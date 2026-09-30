import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isWebPushSupported,
  syncWebPushSubscription,
  unsubscribeWebPushSubscription,
  urlBase64ToUint8Array
} from "./webPush";
import type { ApiClient } from "./api";

describe("webPush", () => {
  describe("urlBase64ToUint8Array", () => {
    it("converts a base64 string to Uint8Array", () => {
      const input = "BM8v-7-4XQ";
      const result = urlBase64ToUint8Array(input);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("isWebPushSupported", () => {
    it("returns false if serviceWorker is missing", () => {
      const originalSW = (navigator as unknown as Record<string, unknown>).serviceWorker;
      delete (navigator as unknown as Record<string, unknown>).serviceWorker;
      expect(isWebPushSupported()).toBe(false);
      (navigator as unknown as Record<string, unknown>).serviceWorker = originalSW;
    });
  });

  describe("syncWebPushSubscription", () => {
    let originalNotification: unknown;
    let originalSW: unknown;
    let originalPushManager: unknown;

    const mockApi: ApiClient = {
      get: vi.fn(),
      post: vi.fn(),
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };

    beforeEach(() => {
      vi.clearAllMocks();
      originalNotification = (globalThis as Record<string, unknown>).Notification;
      originalSW = (navigator as unknown as Record<string, unknown>).serviceWorker;
      originalPushManager = (globalThis as Record<string, unknown>).PushManager;
    });

    afterEach(() => {
      (globalThis as Record<string, unknown>).Notification = originalNotification;
      (navigator as unknown as Record<string, unknown>).serviceWorker = originalSW;
      (globalThis as Record<string, unknown>).PushManager = originalPushManager;
    });

    it("returns false if permission is not granted", async () => {
      (globalThis as Record<string, unknown>).Notification = { permission: "denied" };
      (globalThis as Record<string, unknown>).PushManager = class {};
      (navigator as unknown as Record<string, unknown>).serviceWorker = {
        register: vi.fn()
      };

      const result = await syncWebPushSubscription(mockApi, true, true);
      expect(result).toBe(false);
    });

    it("unsubscribes when enabled is false and subscription exists", async () => {
      const mockUnsubscribe = vi.fn().mockResolvedValue(true);
      const mockSub = {
        endpoint: "https://fcm.googleapis.com/sub/1",
        unsubscribe: mockUnsubscribe
      };

      (globalThis as Record<string, unknown>).Notification = { permission: "granted" };
      (globalThis as Record<string, unknown>).PushManager = class {};
      (navigator as unknown as Record<string, unknown>).serviceWorker = {
        register: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(mockSub)
          }
        })
      };

      const result = await syncWebPushSubscription(mockApi, false, true);
      expect(result).toBe(false);
      expect(mockApi.post).toHaveBeenCalledWith("/api/notifications/web-push/unsubscribe", {
        endpoint: "https://fcm.googleapis.com/sub/1"
      });
      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it("subscribes and posts to API when enabled is true", async () => {
      const mockSub = {
        endpoint: "https://fcm.googleapis.com/sub/1",
        toJSON: () => ({
          endpoint: "https://fcm.googleapis.com/sub/1",
          keys: {
            p256dh: "mock-p256dh",
            auth: "mock-auth"
          }
        })
      };

      (globalThis as Record<string, unknown>).Notification = { permission: "granted" };
      (globalThis as Record<string, unknown>).PushManager = class {};
      (navigator as unknown as Record<string, unknown>).serviceWorker = {
        register: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
            subscribe: vi.fn().mockResolvedValue(mockSub)
          }
        })
      };

      (mockApi.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        publicKey: "BCm_fake_vapid_key",
        enabled: true
      });

      const result = await syncWebPushSubscription(mockApi, true, true);
      expect(result).toBe(true);
      expect(mockApi.post).toHaveBeenCalledWith("/api/notifications/web-push/subscribe", {
        endpoint: "https://fcm.googleapis.com/sub/1",
        keys: {
          p256dh: "mock-p256dh",
          auth: "mock-auth"
        },
        notifyOnBackgroundResponses: true,
        userAgent: navigator.userAgent
      });
    });

    it("returns false when service worker registration fails", async () => {
      (globalThis as Record<string, unknown>).Notification = { permission: "granted" };
      (globalThis as Record<string, unknown>).PushManager = class {};
      (navigator as unknown as Record<string, unknown>).serviceWorker = {
        register: vi.fn().mockRejectedValue(new Error("registration failed"))
      };

      const result = await syncWebPushSubscription(mockApi, true, true);

      expect(result).toBe(false);
      expect(mockApi.get).not.toHaveBeenCalled();
    });

    it("removes the current subscription during logout cleanup", async () => {
      const mockUnsubscribe = vi.fn().mockResolvedValue(true);
      const mockSub = {
        endpoint: "https://fcm.googleapis.com/sub/1",
        unsubscribe: mockUnsubscribe
      };

      (globalThis as Record<string, unknown>).Notification = { permission: "granted" };
      (globalThis as Record<string, unknown>).PushManager = class {};
      (navigator as unknown as Record<string, unknown>).serviceWorker = {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(mockSub)
          }
        })
      };

      const result = await unsubscribeWebPushSubscription(mockApi);

      expect(result).toBe(true);
      expect(mockApi.post).toHaveBeenCalledWith("/api/notifications/web-push/unsubscribe", {
        endpoint: "https://fcm.googleapis.com/sub/1"
      });
      expect(mockUnsubscribe).toHaveBeenCalledOnce();
    });

    it("cleans up an existing subscription even if permission was revoked", async () => {
      const mockUnsubscribe = vi.fn().mockResolvedValue(true);
      const mockSub = {
        endpoint: "https://fcm.googleapis.com/sub/1",
        unsubscribe: mockUnsubscribe
      };

      (globalThis as Record<string, unknown>).Notification = { permission: "denied" };
      (globalThis as Record<string, unknown>).PushManager = class {};
      (navigator as unknown as Record<string, unknown>).serviceWorker = {
        register: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(mockSub)
          }
        })
      };

      const result = await syncWebPushSubscription(mockApi, false, true);

      expect(result).toBe(false);
      expect(mockUnsubscribe).toHaveBeenCalledOnce();
      expect(mockApi.post).toHaveBeenCalledWith("/api/notifications/web-push/unsubscribe", {
        endpoint: "https://fcm.googleapis.com/sub/1"
      });
    });
  });
});
