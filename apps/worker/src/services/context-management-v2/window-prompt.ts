import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { ContextWindowRef } from "@meowbert/run-executor/agent/ports/run-control";
import { query } from "../../lib/db.js";

// The first opener wins, including concurrent retries. Notes can change independently of this
// snapshot; rebuilding it on a resumed run would invalidate the cached conversation.
export async function freezeContextWindowPrompt(
  window: ContextWindowRef,
  items: ResponseInputItem[]
): Promise<ResponseInputItem[]> {
  const result = await query<{ opening_prompt_json: ResponseInputItem[] }>(
    `UPDATE task_context_windows
        SET opening_prompt_json = COALESCE(opening_prompt_json, $3::jsonb)
      WHERE id = $1 AND task_id = $2
      RETURNING opening_prompt_json`,
    [window.windowId, window.taskId, JSON.stringify(items)]
  );
  if (!result.rows[0]) throw new Error("Context window does not belong to this task.");
  return result.rows[0].opening_prompt_json;
}
