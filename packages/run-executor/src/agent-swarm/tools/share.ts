import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { SHARE_TOOL_NAME, shareArgumentsSchema } from "../../agent-tools/swarm.js";
import { toolErrorResult, type ToolCallResult } from "../../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { checkSwarmToolRole } from "./role-gate.js";
import { swarmRunRef } from "./swarm-tool-call.js";

// Siblings share a parent, so the note is scoped to the lane's parent.
export async function handleShare(backend: SwarmBackend, call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<ToolCallResult> {
  const roleError = checkSwarmToolRole(SHARE_TOOL_NAME, ctx.swarm?.run);
  if (roleError) return toolErrorResult(roleError);
  const parsed = shareArgumentsSchema.safeParse(JSON.parse(call.arguments));
  if (!parsed.success) return toolErrorResult("share needs a short text of up to 2,000 characters.");
  await backend.shareNote(swarmRunRef(ctx), parsed.data.text);
  return { output: { shared: true } };
}
