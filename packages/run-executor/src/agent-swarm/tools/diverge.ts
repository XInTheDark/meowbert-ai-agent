import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { resolveAgentSwarmSpawnLimits } from "@meowbert/shared";
import { divergeArgumentsSchema } from "../../agent-tools/swarm.js";
import { buildLaneModelRoute } from "../model-route.js";
import type { SwarmBackend } from "../backend.js";
import { buildDivergeBrief } from "../prompt.js";
import { toolErrorResult, type ToolCallResult } from "../../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../agent-tool-dispatch/types.js";
import { checkForkCallPosition, forkLanesFromCall, laneLabel, type NewLane } from "./fork-call.js";
import { runSwarmToolCall } from "./swarm-tool-call.js";

// The spread must not be limited to the angles the parent can name, so one lane always answers with no
// angle; it is added when every lane was given one, and counts toward the fan-out cap.
export function withUndirectedLane<T extends { title: string; direction: string | null }>(lanes: T[], undirected: T): T[] {
  return lanes.some((lane) => lane.direction === null) ? lanes : [...lanes, undirected];
}

export async function handleDiverge(backend: SwarmBackend, call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, divergeArgumentsSchema, async (args) => {
    const positionError = checkForkCallPosition(call, ctx, state);
    if (positionError) return toolErrorResult(positionError);
    const requested = withUndirectedLane(args.lanes, { title: "Undirected answer", direction: null, model: null, effort: null });
    const maxLanes = resolveAgentSwarmSpawnLimits(ctx.swarm!.run.settings).maxLanesPerParent;
    if (requested.length > maxLanes) {
      return toolErrorResult(`Diverge into at most ${maxLanes} lanes, counting the undirected lane that is always included.`);
    }

    const lanes: NewLane[] = requested.map((lane, index) => ({
      label: laneLabel(index),
      title: lane.title,
      direction: lane.direction,
      weight: 1,
      modelRoute: buildLaneModelRoute(ctx.swarm!.run.router, lane.model, lane.effort)
    }));
    const question = args.question;
    return forkLanesFromCall(backend, {
      call,
      ctx,
      state,
      kind: "diverge",
      lanes,
      spinePath: null,
      buildBrief: (lane) => buildDivergeBrief({ label: lane.label, question, direction: lane.direction, laneDir: lane.laneDir })
    });
  });
}
