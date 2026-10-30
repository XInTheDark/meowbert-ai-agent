import type { ContextWindowRef } from "@meowbert/run-executor/agent/ports/run-control";
import type { WindowRequestState } from "@meowbert/run-executor/agent/window-request-types";
import { query } from "../../lib/db.js";

export async function prepareContextWindowRequest(
  window: ContextWindowRef,
  request: WindowRequestState,
  idle: boolean
): Promise<WindowRequestState> {
  const result = await query<{ request_state_json: WindowRequestState }>(
    `UPDATE task_context_windows
        SET request_state_json = CASE
          WHEN request_state_json IS NULL THEN $3::jsonb
          WHEN $4::boolean THEN request_state_json
          ELSE request_state_json || jsonb_build_object(
            'tools', $3::jsonb->'tools', 'toolChoice', COALESCE($3::jsonb->'toolChoice', '"auto"'::jsonb))
        END
      WHERE id = $1 AND task_id = $2
      RETURNING request_state_json`,
    [window.windowId, window.taskId, JSON.stringify(request), idle]
  );
  if (!result.rows[0]) throw new Error("Context window does not belong to this task.");
  return result.rows[0].request_state_json;
}
