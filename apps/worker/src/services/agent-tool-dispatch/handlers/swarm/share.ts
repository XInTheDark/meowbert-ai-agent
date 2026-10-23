import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { SHARE_TOOL_NAME, shareArgumentsSchema } from "../../../agent-tools/swarm.js";
import { insertSwarmNote } from "../../../agent-swarm/notes-store.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext } from "../../types.js";
import { checkSwarmToolRole } from "./role-gate.js";

// Siblings share a parent, so the note is scoped to the lane's parent.
export async function handleShare(call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<ToolCallResult> {
  const roleError = checkSwarmToolRole(SHARE_TOOL_NAME, ctx.swarm?.run);
  if (roleError) return toolErrorResult(roleError);
  const lane = ctx.swarm!.run.lane!;
  const parsed = shareArgumentsSchema.safeParse(JSON.parse(call.arguments));
  if (!parsed.success) return toolErrorResult("share needs a short text of up to 2,000 characters.");
  await insertSwarmNote({
    swarmTaskId: lane.swarm_task_id,
    authorTaskId: lane.task_id,
    scopeParentTaskId: lane.parent_task_id,
    kind: "shared",
    content: parsed.data.text
  });
  return { output: { shared: true } };
}
