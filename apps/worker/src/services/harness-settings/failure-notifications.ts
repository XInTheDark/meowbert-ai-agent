import { shouldNotifyForHarnessEvent, type HarnessNotify, type TaskExecutionJob } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { sendWebPushNotification } from "../notifications/web-push-dispatch.js";

const PREVIEW_CHARS = 240;

interface FailureNotifyRow {
  title: string | null;
  initiator_user_id: string | null;
  notify: HarnessNotify | null;
}

// A failed run notifies nobody by default. A root task whose notify setting is on_failure gets a
// push for each failed run, and keep-alive stopping after failed cycles notifies unless the
// setting is never.
export async function notifyHarnessFailure(
  job: TaskExecutionJob,
  event: { kind: "run_failed" | "keep_alive_stopped"; message: string }
): Promise<void> {
  const result = await query<FailureNotifyRow>(
    `SELECT t.title, t.initiator_user_id, h.notify
       FROM tasks t
       LEFT JOIN task_harness_settings h ON h.task_id = t.id
      WHERE t.id = $1 AND t.parent_task_id IS NULL AND t.workflow_parent_task_id IS NULL`,
    [job.taskId]
  );
  const row = result.rows[0];
  if (!row) return;
  const send = event.kind === "keep_alive_stopped"
    ? row.notify !== "never"
    : shouldNotifyForHarnessEvent(row.notify, "failure");
  if (!send) return;
  await sendWebPushNotification({
    taskId: job.taskId,
    runId: job.runId,
    taskTitle: row.title,
    workspaceId: job.workspaceId,
    environmentId: job.environmentId,
    preview: event.message.length > PREVIEW_CHARS ? `${event.message.slice(0, PREVIEW_CHARS)}…` : event.message,
    targetUserId: job.selectionUserId ?? row.initiator_user_id
  });
}
