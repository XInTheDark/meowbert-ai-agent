import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { SPLIT_TOOL_NAME, splitArgumentsSchema } from "../../../agent-tools/swarm.js";
import type { NewLane } from "../../../agent-swarm/lane-creation.js";
import { buildLaneBrief } from "../../../agent-swarm/prompt.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../types.js";
import { checkForkCallPosition, forkLanesFromCall, laneLabel } from "./fork-call.js";
import { checkSwarmToolRole } from "./role-gate.js";

export async function handleSplit(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  const roleError = checkSwarmToolRole(SPLIT_TOOL_NAME, ctx.swarm?.run) ?? checkForkCallPosition(call, ctx, state);
  if (roleError) return toolErrorResult(roleError);
  const parsed = splitArgumentsSchema.safeParse(JSON.parse(call.arguments));
  if (!parsed.success) return toolErrorResult(`Invalid split arguments: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  const maxLanes = ctx.swarm!.run.settings.advanced.maxLanesPerParent;
  if (parsed.data.lanes.length > maxLanes) return toolErrorResult(`Split into at most ${maxLanes} lanes.`);

  const lanes: NewLane[] = parsed.data.lanes.map((lane, index) => ({
    label: laneLabel(index),
    title: lane.title,
    direction: lane.direction,
    weight: lane.weight ?? 1
  }));
  const spinePath = parsed.data.spine_path;
  return forkLanesFromCall({
    call,
    ctx,
    state,
    kind: "split",
    lanes,
    spinePath,
    buildBrief: (lane) => buildLaneBrief({
      label: lane.label,
      title: lane.title,
      direction: lane.direction,
      laneDir: lane.laneDir,
      spinePath,
      siblingTitles: lanes.filter((other) => other.label !== lane.label).map((other) => `${other.label} ${other.title}`)
    })
  });
}
