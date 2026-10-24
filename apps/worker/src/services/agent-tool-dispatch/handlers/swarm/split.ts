import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { resolveAgentSwarmSpawnLimits } from "@meowbert/shared";
import { splitArgumentsSchema } from "@meowbert/run-executor/agent-tools/swarm";
import type { NewLane } from "../../../agent-swarm/lane-creation.js";
import { buildLaneModelRoute } from "../../../agent-swarm/model-route.js";
import { buildLaneBrief } from "@meowbert/run-executor/agent-swarm/prompt";
import { toolErrorResult, type ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { checkForkCallPosition, forkLanesFromCall, laneLabel } from "./fork-call.js";
import { runSwarmToolCall } from "./swarm-tool-call.js";

export async function handleSplit(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, splitArgumentsSchema, async (args) => {
    const positionError = checkForkCallPosition(call, ctx, state);
    if (positionError) return toolErrorResult(positionError);
    const maxLanes = resolveAgentSwarmSpawnLimits(ctx.swarm!.run.settings).maxLanesPerParent;
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
