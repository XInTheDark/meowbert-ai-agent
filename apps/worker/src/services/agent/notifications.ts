import { emitTaskEvent } from "../runtime/events.js";
import { sendTelegramResultIfNeeded } from "../communications/telegram.js";
import { sendDiscordResultIfNeeded } from "../communications/discord.js";
import { sendGitHubResultIfNeeded } from "../github/index.js";
import { sendEmailResultIfNeeded } from "../email/index.js";
import { sendWebPushNotification } from "../notifications/web-push-dispatch.js";
import type { RunDeliveryInput, RunDeliveryChannel } from "../notifications/run-delivery-types.js";

export async function emitRunNotifications(input: RunDeliveryInput, channel?: RunDeliveryChannel): Promise<void> {
  if (input.isSubtask || input.finalResponse.length === 0) {
    return;
  }

  const preview =
    input.finalResponse.length > 240
      ? `${input.finalResponse.slice(0, 240)}…`
      : input.finalResponse;
  if (!channel || channel === "web") {
    await emitTaskEvent(input.taskId, "notification", {
      channel: "web",
      status: input.notificationRequested ? "sent" : "suppressed",
      runId: input.runId,
      preview
    });
  }

  if (!input.notificationRequested) {
    return;
  }

  if ((!channel || channel === "push") && input.workspaceId && input.environmentId) {
    await sendWebPushNotification({
      taskId: input.taskId,
      runId: input.runId,
      taskTitle: input.taskTitle ?? null,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      preview,
      targetUserId: input.targetUserId ?? null
    });
  }

  const senders = {
    telegram: sendTelegramResultIfNeeded,
    discord: sendDiscordResultIfNeeded,
    github: sendGitHubResultIfNeeded,
    email: sendEmailResultIfNeeded
  };
  const deliveries = [];
  for (const [name, send] of Object.entries(senders)) {
    if (channel && channel !== name) continue;
    const delivery = await send(input.taskId, input.connectorContextId, input.finalResponse);
    if (delivery.status === "failed") throw new Error(`${name}: ${delivery.detail ?? "Delivery failed"}`);
    deliveries.push(delivery);
  }

  for (const delivery of deliveries) {
    if (delivery.status === "skipped" && !input.connectorContextId) {
      continue;
    }

    await emitTaskEvent(input.taskId, "notification", {
      channel: delivery.channel,
      status: delivery.status,
      runId: input.runId,
      ...(delivery.detail ? { detail: delivery.detail } : {}),
      ...(delivery.externalMessageId ? { externalMessageId: delivery.externalMessageId } : {})
    }).catch((error) => {
      // A log failure must not cause an already-sent connector reply to be sent again.
      console.warn("Unable to publish delivery status", error);
    });
  }
}
