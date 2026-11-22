import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { listLanesArgumentsSchema } from "../../agent-tools/swarm.js";
import type { ToolCallResult } from "../../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { runSwarmToolCall, swarmRunRef } from "./swarm-tool-call.js";

export async function handleListLanes(backend: SwarmBackend, call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, listLanesArgumentsSchema, async () => {
    const lanes = await backend.listLanes(swarmRunRef(ctx));
    return { output: lanes.length > 0 ? { lanes } : { lanes, message: "You have not started any lanes." } };
  });
}
