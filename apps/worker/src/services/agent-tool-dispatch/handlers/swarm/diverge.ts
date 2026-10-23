import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { DIVERGE_TOOL_NAME, divergeArgumentsSchema } from "../../../agent-tools/swarm.js";
import type { NewLane } from "../../../agent-swarm/lane-creation.js";
import { buildDivergeBrief } from "../../../agent-swarm/prompt.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../types.js";
import { checkForkCallPosition, forkLanesFromCall, laneLabel } from "./fork-call.js";
import { checkSwarmToolRole } from "./role-gate.js";

// The spread must not be limited to the angles the parent can name, so one lane always answers with no
// angle; it is added when every lane was given one, and counts toward the fan-out cap.
export function withUndirectedLane<T extends { title: string; direction: string | null }>(lanes: T[], undirected: T): T[] {
  return lanes.some((lane) => lane.direction === null) ? lanes : [...lanes, undirected];
}

export async function handleDiverge(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  const roleError = checkSwarmToolRole(DIVERGE_TOOL_NAME, ctx.swarm?.run) ?? checkForkCallPosition(call, ctx, state);
  if (roleError) return toolErrorResult(roleError);
  const parsed = divergeArgumentsSchema.safeParse(JSON.parse(call.arguments));
  if (!parsed.success) return toolErrorResult(`Invalid diverge arguments: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  const requested = withUndirectedLane(parsed.data.lanes, { title: "Undirected answer", direction: null });
  const maxLanes = ctx.swarm!.run.settings.advanced.maxLanesPerParent;
  if (requested.length > maxLanes) {
    return toolErrorResult(`Diverge into at most ${maxLanes} lanes, counting the undirected lane that is always included.`);
  }

  const lanes: NewLane[] = requested.map((lane, index) => ({
    label: laneLabel(index),
    title: lane.title,
    direction: lane.direction,
    weight: 1
  }));
  const question = parsed.data.question;
  return forkLanesFromCall({
    call,
    ctx,
    state,
    kind: "diverge",
    lanes,
    spinePath: null,
    buildBrief: (lane) => buildDivergeBrief({ label: lane.label, question, direction: lane.direction, laneDir: lane.laneDir })
  });
}
