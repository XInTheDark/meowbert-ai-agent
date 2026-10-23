import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { splitArgumentsSchema } from "../../../agent-tools/swarm.js";
import type { NewLane } from "../../../agent-swarm/lane-creation.js";
import { buildLaneModelRoute } from "../../../agent-swarm/model-route.js";
import { buildLaneBrief } from "../../../agent-swarm/prompt.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../types.js";
import { checkForkCallPosition, forkLanesFromCall, laneLabel } from "./fork-call.js";
import { runSwarmToolCall } from "./swarm-tool-call.js";

export async function handleSplit(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, splitArgumentsSchema, async (args) => {
    const positionError = checkForkCallPosition(call, ctx, state);
    if (positionError) return toolErrorResult(positionError);
    const maxLanes = ctx.swarm!.run.settings.advanced.maxLanesPerParent;
    if (args.lanes.length > maxLanes) return toolErrorResult(`Split into at most ${maxLanes} lanes.`);

    const lanes: NewLane[] = args.lanes.map((lane, index) => ({
      label: laneLabel(index),
      title: lane.title,
      direction: lane.direction,
      weight: lane.weight ?? 1,
      modelRoute: buildLaneModelRoute(ctx.swarm!.run.router, lane.model, lane.effort)
    }));
    const spinePath = args.spine_path;
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
  });
}
