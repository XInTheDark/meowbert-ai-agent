import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../../lib/config.js", () => ({
  config: {
    webPush: undefined
  }
}));

vi.mock("./cancellable-web-push.js", () => ({
  sendCancellableWebPushRequest: vi.fn()
}));

import { query } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import { sendCancellableWebPushRequest } from "./cancellable-web-push.js";
import { sendWebPushNotification } from "./web-push-dispatch.js";

const mockedQuery = vi.mocked(query);
const mockedSendNotification = vi.mocked(sendCancellableWebPushRequest);

describe("web-push-dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips dispatch if webPush is explicitly disabled in config", async () => {
    (config as Record<string, unknown>).webPush = { enabled: false };

    await sendWebPushNotification({
      taskId: "task-1",
      runId: "run-1",
      taskTitle: "Test Task",
      workspaceId: "ws-1",
      environmentId: "env-1",
      preview: "Done!",
      targetUserId: "user-1"
    });

    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedSendNotification).not.toHaveBeenCalled();

    (config as Record<string, unknown>).webPush = undefined;
  });

  it("sends notification to target user subscriptions", async () => {
    mockedQuery
      // 1. resolveWorkerVapidKeys
      .mockResolvedValueOnce({
        rows: [
          {
            web_push_vapid_public_key: "test-vapid-public-key",
            web_push_vapid_private_key: "test-vapid-private-key",
            web_push_contact_email: "mailto:ops@example.com"
          }
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      })
      // 2. resolveTargetSubscriptions
      .mockResolvedValueOnce({
        rows: [
          {
            id: "sub-1",
            user_id: "user-1",
            endpoint: "https://fcm.googleapis.com/sub/1",
            p256dh: "client-p256dh",
            auth: "client-auth",
            notify_on_background_responses: true,
            task_type: "standard"
          }
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      });

    mockedSendNotification.mockResolvedValueOnce();

    await sendWebPushNotification({
      taskId: "task-1",
      runId: "run-1",
      taskTitle: "My Agent Task",
      workspaceId: "ws-1",
      environmentId: "env-1",
      preview: "Task finished successfully.",
      targetUserId: "user-1"
    });

    expect(mockedSendNotification).toHaveBeenCalledTimes(1);
    const [sub, payload, vapid, timeout] = mockedSendNotification.mock.calls[0];
    expect(sub.endpoint).toBe("https://fcm.googleapis.com/sub/1");
    const parsedPayload = JSON.parse(payload as string);
    expect(parsedPayload.title).toBe("Task response: My Agent Task");
    expect(parsedPayload.body).toBe("Task finished successfully.");
    expect(parsedPayload.route).toBe("/app/ws-1/projects/env-1/tasks/task-1");
    expect(vapid?.publicKey).toBe("test-vapid-public-key");
    expect(timeout).toBe(10_000);
    const subscriptionSql = mockedQuery.mock.calls[1][0];
    const subscriptionParams = mockedQuery.mock.calls[1][1];
    expect(subscriptionSql).toContain("JOIN workspace_members");
    expect(subscriptionSql).toContain("JOIN tasks");
    expect(subscriptionParams).toEqual(["ws-1", "task-1", "user-1"]);
  });

  it("skips standard task notifications when the subscription opts out", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            web_push_vapid_public_key: "test-vapid-public-key",
            web_push_vapid_private_key: "test-vapid-private-key",
            web_push_contact_email: "mailto:ops@example.com"
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
            id: "sub-quiet",
            user_id: "user-1",
            endpoint: "https://fcm.googleapis.com/sub/quiet",
            p256dh: "client-p256dh",
            auth: "client-auth",
            notify_on_background_responses: false,
            task_type: "standard"
          }
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      });

    await sendWebPushNotification({
      taskId: "task-1",
      runId: "run-1",
      taskTitle: "My Agent Task",
      workspaceId: "ws-1",
      environmentId: "env-1",
      preview: "Task finished.",
      targetUserId: "user-1"
    });

    expect(mockedSendNotification).not.toHaveBeenCalled();
  });

  it("does not send to an unsupported stored endpoint", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            web_push_vapid_public_key: "test-vapid-public-key",
            web_push_vapid_private_key: "test-vapid-private-key",
            web_push_contact_email: "mailto:ops@example.com"
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
            id: "sub-invalid",
            user_id: "user-1",
            endpoint: "https://internal.example.com/push",
            p256dh: "client-p256dh",
            auth: "client-auth",
            notify_on_background_responses: true,
            task_type: "standard"
          }
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      });

    await sendWebPushNotification({
      taskId: "task-1",
      runId: "run-1",
      taskTitle: "My Agent Task",
      workspaceId: "ws-1",
      environmentId: "env-1",
      preview: "Task finished.",
      targetUserId: "user-1"
    });

    expect(mockedSendNotification).not.toHaveBeenCalled();
  });

  it("prunes expired subscriptions returning 410 Gone", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            web_push_vapid_public_key: "test-vapid-public-key",
            web_push_vapid_private_key: "test-vapid-private-key",
            web_push_contact_email: "mailto:ops@example.com"
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
            id: "sub-gone",
            user_id: "user-1",
            endpoint: "https://fcm.googleapis.com/sub/gone",
            p256dh: "client-p256dh",
            auth: "client-auth",
            notify_on_background_responses: true,
            task_type: "standard"
          }
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      })
      // 3. DELETE query
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: "DELETE",
        oid: 0,
        fields: []
      });

    const error = new Error("Subscription expired") as Error & { statusCode: number };
    error.statusCode = 410;
    mockedSendNotification.mockRejectedValueOnce(error);

    await sendWebPushNotification({
      taskId: "task-1",
      runId: "run-1",
      taskTitle: "My Agent Task",
      workspaceId: "ws-1",
      environmentId: "env-1",
      preview: "Task finished.",
      targetUserId: "user-1"
    });

    expect(mockedQuery).toHaveBeenCalledTimes(3);
    const deleteSql = mockedQuery.mock.calls[2][0];
    const deleteParams = mockedQuery.mock.calls[2][1];
    expect(deleteSql).toContain("DELETE FROM web_push_subscriptions WHERE id = $1");
    expect(deleteParams).toEqual(["sub-gone"]);
  });

});
