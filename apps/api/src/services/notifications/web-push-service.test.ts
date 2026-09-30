import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../../lib/config.js", () => ({
  config: {
    webPush: undefined
  }
}));

vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: vi.fn(() => ({
      publicKey: "generated-public-key-value",
      privateKey: "generated-private-key-value"
    }))
  }
}));

import { query } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import {
  getWebPushPublicKey,
  removeWebPushSubscription,
  resetCachedVapidKeysForTest,
  resolveVapidKeys,
  saveWebPushSubscription
} from "./web-push-service.js";

const mockedQuery = vi.mocked(query);

describe("web-push-service", () => {
  beforeEach(() => {
    resetCachedVapidKeysForTest();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetCachedVapidKeysForTest();
    vi.restoreAllMocks();
  });

  it("resolves VAPID keys from platform_settings when present", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          web_push_vapid_public_key: "existing-public-key",
          web_push_vapid_private_key: "existing-private-key",
          web_push_contact_email: "mailto:ops@example.com"
        }
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: []
    });

    const keys = await resolveVapidKeys();
    expect(keys.publicKey).toBe("existing-public-key");
    expect(keys.privateKey).toBe("existing-private-key");
    expect(keys.contactEmail).toBe("mailto:ops@example.com");
  });

  it("generates and stores VAPID keys if none exist in database", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            web_push_vapid_public_key: null,
            web_push_vapid_private_key: null,
            web_push_contact_email: null
          }
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      })
      .mockResolvedValueOnce({
        rows: [
          {
            web_push_vapid_public_key: "generated-public-key-value",
            web_push_vapid_private_key: "generated-private-key-value",
            web_push_contact_email: "mailto:admin@meowbert.local"
          }
        ],
        rowCount: 1,
        command: "UPDATE",
        oid: 0,
        fields: []
      });

    const keys = await resolveVapidKeys();
    expect(typeof keys.publicKey).toBe("string");
    expect(keys.publicKey.length).toBeGreaterThan(20);
    expect(typeof keys.privateKey).toBe("string");
    expect(keys.contactEmail).toBe("mailto:admin@meowbert.local");
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it("uses the persisted VAPID keys when another instance wins initialization", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            web_push_vapid_public_key: null,
            web_push_vapid_private_key: null,
            web_push_contact_email: null
          }
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "UPDATE",
        oid: 0,
        fields: []
      })
      .mockResolvedValueOnce({
        rows: [
          {
            web_push_vapid_public_key: "winner-public-key",
            web_push_vapid_private_key: "winner-private-key",
            web_push_contact_email: "mailto:winner@example.com"
          }
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      });

    const keys = await resolveVapidKeys();

    expect(keys).toEqual({
      publicKey: "winner-public-key",
      privateKey: "winner-private-key",
      contactEmail: "mailto:winner@example.com"
    });
    expect(mockedQuery).toHaveBeenCalledTimes(3);
  });

  it("returns enabled false when config has webPush.enabled = false", async () => {
    (config as Record<string, unknown>).webPush = { enabled: false };

    const result = await getWebPushPublicKey();
    expect(result.enabled).toBe(false);
    expect(result.publicKey).toBe("");

    (config as Record<string, unknown>).webPush = undefined;
  });

  it("saves a web push subscription with upsert", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: []
    });

    await saveWebPushSubscription("user-123", {
      endpoint: "https://fcm.googleapis.com/sub/123",
      keys: {
        p256dh: "client-p256dh-key",
        auth: "client-auth-secret"
      },
      notifyOnBackgroundResponses: false,
      userAgent: "Mozilla/5.0"
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const sql = mockedQuery.mock.calls[0][0];
    const params = mockedQuery.mock.calls[0][1];
    expect(sql).toContain("INSERT INTO web_push_subscriptions");
    expect(params).toEqual([
      "user-123",
      "https://fcm.googleapis.com/sub/123",
      "client-p256dh-key",
      "client-auth-secret",
      "Mozilla/5.0",
      false
    ]);
  });

  it("rejects unsupported push endpoints before persistence", async () => {
    await expect(saveWebPushSubscription("user-123", {
      endpoint: "https://internal.example.com/push",
      keys: {
        p256dh: "client-p256dh-key",
        auth: "client-auth-secret"
      },
      notifyOnBackgroundResponses: true
    })).rejects.toThrow("Unsupported Web Push endpoint");
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("removes a web push subscription", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
      command: "DELETE",
      oid: 0,
      fields: []
    });

    await removeWebPushSubscription("user-123", "https://fcm.googleapis.com/sub/123");

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const sql = mockedQuery.mock.calls[0][0];
    const params = mockedQuery.mock.calls[0][1];
    expect(sql).toContain("DELETE FROM web_push_subscriptions");
    expect(params).toEqual(["user-123", "https://fcm.googleapis.com/sub/123"]);
  });
});
