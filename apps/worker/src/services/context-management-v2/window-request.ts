import type { ContextWindowRef } from "@meowbert/run-executor/agent/ports/run-control";
import type { WindowRequestState, WindowRequestUpdate } from "@meowbert/run-executor/agent/window-request-types";
import { query } from "../../lib/db.js";

// Executors from before the update modes sent true for idle replays and false for ordinary turns.
function normalizeUpdate(update: WindowRequestUpdate | boolean): WindowRequestUpdate {
  if (typeof update === "boolean") return update ? "replay" : "tools";
  return update;
}

export async function prepareContextWindowRequest(
  window: ContextWindowRef,
  request: WindowRequestState,
  update: WindowRequestUpdate | boolean
): Promise<WindowRequestState> {
  const result = await query<{ request_state_json: WindowRequestState }>(
    `UPDATE task_context_windows
        SET request_state_json = CASE
          WHEN request_state_json IS NULL THEN $3::jsonb
          WHEN $4::text = 'replay' THEN request_state_json
          WHEN $4::text = 'tool_choice' THEN request_state_json || jsonb_build_object(
            'toolChoice', COALESCE($3::jsonb->'toolChoice', '"auto"'::jsonb))
          ELSE request_state_json || jsonb_build_object(
            'tools', $3::jsonb->'tools', 'toolChoice', COALESCE($3::jsonb->'toolChoice', '"auto"'::jsonb))
        END
      WHERE id = $1 AND task_id = $2
      RETURNING request_state_json`,
    [window.windowId, window.taskId, JSON.stringify(request), normalizeUpdate(update)]
  );
  if (!result.rows[0]) throw new Error("Context window does not belong to this task.");
  return result.rows[0].request_state_json;
}
