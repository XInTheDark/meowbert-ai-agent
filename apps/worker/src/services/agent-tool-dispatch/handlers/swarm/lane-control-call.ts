import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { ZodType } from "zod";
import { LaneControlError } from "../../../agent-swarm/lane-control.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext } from "../../types.js";
import { checkSwarmToolRole } from "./role-gate.js";

// The shared shape of steer, stop and resume: role check, arguments, then an action on one of the
// caller's own lanes whose refusals become tool errors.
export async function runLaneControlCall<T>(
  call: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  schema: ZodType<T>,
  action: (args: T) => Promise<ToolCallResult>
): Promise<ToolCallResult> {
  const roleError = checkSwarmToolRole(call.name, ctx.swarm?.run);
  if (roleError) return toolErrorResult(roleError);
  const parsed = schema.safeParse(JSON.parse(call.arguments));
  if (!parsed.success) {
    return toolErrorResult(`Invalid ${call.name} arguments: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  try {
    return await action(parsed.data);
  } catch (error) {
    if (error instanceof LaneControlError) return toolErrorResult(error.message);
    throw error;
  }
}
