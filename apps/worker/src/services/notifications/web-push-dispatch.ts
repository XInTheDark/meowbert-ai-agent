import { isAllowedWebPushEndpoint, type WebPushNotificationPayload } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import { sendCancellableWebPushRequest } from "./cancellable-web-push.js";

interface VapidKeysRecord {
  publicKey: string;
  privateKey: string;
  contactEmail: string;
}

export const WEB_PUSH_REQUEST_TIMEOUT_MS = 10_000;

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  notify_on_background_responses: boolean;
  task_type: TaskNotificationType;
}

type TaskNotificationType = "standard" | "scheduled" | "infinite" | "timed" | "long_horizon" | "agent_swarm";

export interface DispatchWebPushNotificationInput {
  taskId: string;
  runId: string;
  taskTitle: string | null;
  workspaceId: string;
  environmentId: string;
  preview: string;
  targetUserId: string | null;
}

function normalizeContactEmail(email: string | undefined): string {
  if (!email || email.trim().length === 0) {
    return "mailto:admin@meowbert.local";
  }
  return email.startsWith("mailto:") ? email : `mailto:${email}`;
}

async function resolveWorkerVapidKeys(): Promise<VapidKeysRecord | null> {
  const configVapid = config.webPush;
  const hasConfiguredPublicKey = Boolean(configVapid?.vapidPublicKey);
  const hasConfiguredPrivateKey = Boolean(configVapid?.vapidPrivateKey);
  if (hasConfiguredPublicKey !== hasConfiguredPrivateKey) {
    throw new Error("Web Push VAPID configuration must include both public and private keys");
  }

  if (hasConfiguredPublicKey && hasConfiguredPrivateKey) {
    return {
      publicKey: configVapid!.vapidPublicKey!,
      privateKey: configVapid!.vapidPrivateKey!,
      contactEmail: normalizeContactEmail(configVapid!.contactEmail)
    };
  }

  const result = await query<{
    web_push_vapid_public_key: string | null;
    web_push_vapid_private_key: string | null;
    web_push_contact_email: string | null;
  }>(
    `SELECT web_push_vapid_public_key, web_push_vapid_private_key, web_push_contact_email
       FROM platform_settings
      WHERE id = 1`
  );

  const row = result.rows[0];
  const hasStoredPublicKey = Boolean(row?.web_push_vapid_public_key);
  const hasStoredPrivateKey = Boolean(row?.web_push_vapid_private_key);
  if (hasStoredPublicKey !== hasStoredPrivateKey) {
    throw new Error("Incomplete Web Push VAPID keys in platform_settings");
  }

  if (hasStoredPublicKey && hasStoredPrivateKey) {
    return {
      publicKey: row!.web_push_vapid_public_key!,
      privateKey: row!.web_push_vapid_private_key!,
      contactEmail: normalizeContactEmail(row!.web_push_contact_email ?? undefined)
    };
  }

  return null;
}

async function resolveTargetSubscriptions(
  workspaceId: string,
  taskId: string,
  targetUserId: string | null
): Promise<PushSubscriptionRow[]> {
  if (targetUserId) {
    const result = await query<PushSubscriptionRow>(
      `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth,
              s.notify_on_background_responses,
              CASE
                WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
                WHEN ts.task_id IS NULL THEN 'standard'
                WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
                ELSE ts.mode
              END AS task_type
         FROM web_push_subscriptions s
         JOIN workspace_members m
           ON m.user_id = s.user_id
          AND m.workspace_id = $1
         JOIN tasks t
           ON t.id = $2
          AND t.workspace_id = m.workspace_id
         LEFT JOIN task_schedules ts
           ON ts.task_id = t.id
        WHERE s.user_id = $3
          AND t.trashed_at IS NULL
          AND t.workflow_parent_task_id IS NULL`,
      [workspaceId, taskId, targetUserId]
    );
    return result.rows;
  }

  const result = await query<PushSubscriptionRow>(
    `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth,
            s.notify_on_background_responses,
            CASE
              WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
              WHEN ts.task_id IS NULL THEN 'standard'
              WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
              ELSE ts.mode
            END AS task_type
       FROM web_push_subscriptions s
       JOIN workspace_members m ON m.user_id = s.user_id
       JOIN tasks t
         ON t.id = $2
        AND t.workspace_id = m.workspace_id
       LEFT JOIN task_schedules ts
         ON ts.task_id = t.id
      WHERE m.workspace_id = $1
        AND t.trashed_at IS NULL
        AND t.workflow_parent_task_id IS NULL`,
    [workspaceId, taskId]
  );
  return result.rows;
}

function isRecurringTaskType(taskType: TaskNotificationType): boolean {
  return taskType === "scheduled" || taskType === "infinite" || taskType === "timed";
}

async function sendSinglePush(
  sub: PushSubscriptionRow,
  payloadString: string,
  vapid: VapidKeysRecord
): Promise<void> {
  if (!isAllowedWebPushEndpoint(sub.endpoint)) {
    return;
  }

  try {
    await sendCancellableWebPushRequest(
      {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      },
      payloadString,
      {
        subject: vapid.contactEmail,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey
      },
      WEB_PUSH_REQUEST_TIMEOUT_MS
    );
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await query("DELETE FROM web_push_subscriptions WHERE id = $1", [sub.id]);
    }
  }
}

export async function sendWebPushNotification(
  input: DispatchWebPushNotificationInput
): Promise<void> {
  try {
    if (config.webPush?.enabled === false) {
      return;
    }

    const vapid = await resolveWorkerVapidKeys();
    if (!vapid) {
      return;
    }

    const subscriptions = (await resolveTargetSubscriptions(
      input.workspaceId,
      input.taskId,
      input.targetUserId
    )).filter((subscription) =>
      isRecurringTaskType(subscription.task_type) || subscription.notify_on_background_responses
    );
    if (subscriptions.length === 0) {
      return;
    }

    const payload: WebPushNotificationPayload = {
      title: `Task response: ${input.taskTitle ?? "Untitled task"}`,
      body: input.preview,
      tag: `meowbert-task-${input.taskId}`,
      route: `/app/${input.workspaceId}/projects/${input.environmentId}/tasks/${input.taskId}`,
      taskId: input.taskId,
      runId: input.runId
    };

    const payloadString = JSON.stringify(payload);
    await Promise.allSettled(
      subscriptions.map((sub) => sendSinglePush(sub, payloadString, vapid))
    );
  } catch (err) {
    console.error("[web-push] Failed to send web push notifications:", err);
  }
}
