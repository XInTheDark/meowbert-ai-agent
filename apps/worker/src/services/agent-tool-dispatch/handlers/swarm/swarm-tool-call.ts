import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { ZodType } from "zod";
import { SwarmToolError } from "../../../agent-swarm/tool-error.js";
import { toolErrorResult, type ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { checkSwarmToolRole } from "./role-gate.js";

// The shared shape of the swarm tools that act on lanes: role check, arguments, then an action whose
// refusals become tool errors.
export async function runSwarmToolCall<T>(
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
    if (error instanceof SwarmToolError) return toolErrorResult(error.message);
    throw error;
  }
}
