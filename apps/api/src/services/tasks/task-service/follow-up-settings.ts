import type { PoolClient } from "pg";
import type { ProjectCanvasIntent } from "../../canvases/project-canvases.js";
import { recordProjectMasterReplyContextInTx } from "../../project-master/reply-contexts.js";

// Task settings a follow-up message carries, applied whether it starts a run or waits in the queue.
export async function applyFollowUpTaskSettingsInTx(client: PoolClient, input: {
  taskId: string;
  userId?: string;
  interactiveCanvasId?: string | null;
  interactiveCanvasIntent?: ProjectCanvasIntent | null;
  connectorContextId?: string | null;
}): Promise<void> {
  if (input.connectorContextId !== undefined) {
    await client.query(
      `UPDATE tasks
          SET connector_context_id = $2,
              updated_at = now()
        WHERE id = $1`,
      [input.taskId, input.connectorContextId]
    );
    if (input.userId) {
      await recordProjectMasterReplyContextInTx(client, {
        taskId: input.taskId,
        userId: input.userId,
        connectorContextId: input.connectorContextId
      });
    }
  }

  if (input.interactiveCanvasId !== undefined || input.interactiveCanvasIntent !== undefined) {
    await client.query(
      `UPDATE tasks
          SET interactive_canvas_id = COALESCE($2, interactive_canvas_id),
              interactive_canvas_intent = COALESCE($3, interactive_canvas_intent),
              updated_at = now()
        WHERE id = $1`,
      [
        input.taskId,
        input.interactiveCanvasId ?? null,
        input.interactiveCanvasIntent ?? (input.interactiveCanvasId ? "update" : null)
      ]
    );
  }

  if (input.userId) {
    await client.query(
      `UPDATE tasks
          SET initiator_user_id = $2,
              updated_at = now()
        WHERE id = $1
          AND initiator_user_id IS NULL`,
      [input.taskId, input.userId]
    );
  }
}
