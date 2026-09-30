import {
  TASK_EVENT_CHANNEL_PREFIX,
  WORKSPACE_NOTIFICATION_CHANNEL_PREFIX,
  type TaskEventPayload,
  type TaskEventType
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { redis } from "../../lib/redis.js";

export async function appendTaskEvent(taskId: string, type: TaskEventType, payload: Record<string, unknown>): Promise<void> {
  const createdAt = new Date().toISOString();
  const insertRes = await query<{ id: string }>(
    `INSERT INTO task_events (task_id, type, payload_json)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id`,
    [taskId, type, JSON.stringify(payload)]
  );
  const eventId = insertRes.rows[0]?.id;
  if (!eventId) {
    throw new Error("Failed to create task event");
  }

  const eventPayload: TaskEventPayload = {
    id: eventId,
    taskId,
    type,
    payload,
    createdAt
  };

  await redis.publish(`${TASK_EVENT_CHANNEL_PREFIX}${taskId}`, JSON.stringify(eventPayload));

  if (type === "notification") {
    try {
      const workspaceResult = await query<{ workspace_id: string }>(
        `SELECT workspace_id
           FROM tasks
          WHERE id = $1`,
        [taskId]
      );
      const workspaceId = workspaceResult.rows[0]?.workspace_id;
      if (workspaceId) {
        await redis.publish(`${WORKSPACE_NOTIFICATION_CHANNEL_PREFIX}${workspaceId}`, JSON.stringify(eventPayload));
      }
    } catch (error) {
      console.error("Failed to publish workspace notification event", error);
    }
  }
}
