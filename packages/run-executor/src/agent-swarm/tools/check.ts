import { randomUUID } from "node:crypto";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { normalizeReviewEffort, type ChosenModelRoute, type ReviewEffort } from "@meowbert/shared";
import { checkArgumentsSchema } from "../../agent-tools/swarm.js";
import { toolErrorResult, type ToolCallResult } from "../../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { buildLaneModelRoute, pickCheckModelRoute } from "../model-route.js";
import { buildCheckBrief, buildCheckStartedMessage } from "../prompt.js";
import { SwarmToolError } from "../tool-error.js";
import { laneDirectory } from "./fork-call.js";
import { runSwarmToolCall, swarmRunRef } from "./swarm-tool-call.js";

// A Check lane is a fresh task, never a fork: it gets every message the user wrote on the swarm's
// branch and the deliverable, never the author's reasoning.
async function startCheck(backend: SwarmBackend, ctx: ToolDispatchContext, state: ToolDispatchState, input: {
  draft: string;
  files: string[];
  focus: string | null;
  reviewEffort: ReviewEffort;
  modelRoute: ChosenModelRoute | null;
}): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const swarm = ctx.swarm!;
  const run = swarmRunRef(ctx);
  const { userMessages, spinePath } = await backend.loadCheckInputs(run, swarm.run.lane ? null : ctx.getCurrentLeafMessageId());
  const laneTaskId = randomUUID();
  const lane = await backend.startCheckLane(run, {
    reviewEffort: input.reviewEffort,
    laneTaskId,
    brief: buildCheckBrief({
      userMessages,
      draft: input.draft,
      files: input.files,
      spinePath,
      focus: input.focus,
      laneDir: laneDirectory(ctx, laneTaskId)
    }),
    capabilities: {
      runtime: structuredClone(swarm.runtime),
      runToolOptions: structuredClone(swarm.runToolOptions),
      loadedToolGroups: [],
      spinePath
    },
    focus: input.focus,
    modelRoute: input.modelRoute
  });
  state.swarmPark = { reason: "check" };
  await backend.emitEvent(run, "Started a Check lane.");
  return { output: { lane_id: lane.taskId, message: buildCheckStartedMessage() } };
}

export async function handleCheck(backend: SwarmBackend, call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  if (ctx.codeModeParentCallId) return toolErrorResult("Call check directly, not from exec.");
  return runSwarmToolCall(call, ctx, checkArgumentsSchema, async (args) => {
    if (ctx.swarm!.run.lane && !await backend.hasOwnLanes(swarmRunRef(ctx))) {
      return toolErrorResult("Only the leader and lanes that have lanes of their own can start a check. Submit your part instead.");
    }
    return startCheck(backend, ctx, state, {
      draft: args.draft,
      files: args.files,
      focus: args.focus,
      reviewEffort: normalizeReviewEffort(args.review_effort),
      modelRoute: buildLaneModelRoute(ctx.swarm!.run.router, args.model, args.effort)
    });
  });
}

// The automatic Check: a leader reply on a turn that used lanes goes to a fresh reviewer first. The
// draft is not delivered; the leader resumes with the findings and replies again. Returns null when
// the reply should be delivered as usual.
export async function interceptFinalResponseForCheck(
  backend: SwarmBackend,
  call: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult | null> {
  const swarm = ctx.swarm;
  if (!swarm || swarm.run.lane || !swarm.run.settings.advanced.autoCheck || ctx.codeModeParentCallId) return null;
  const args = (() => {
    try {
      return JSON.parse(call.arguments) as { response?: unknown; partial?: unknown };
    } catch {
      return null;
    }
  })();
  // Partial replies are progress updates, not the deliverable; malformed calls get the usual error.
  const draft = typeof args?.response === "string" ? args.response.trim() : "";
  if (!draft || args?.partial === true) return null;
  const files = await backend.loadAutoCheckFiles(swarmRunRef(ctx));
  if (!files) return null;
  try {
    return await startCheck(backend, ctx, state, {
      draft,
      files,
      focus: null,
      reviewEffort: "standard",
      modelRoute: pickCheckModelRoute(swarm.run.router, swarm.runtime.model)
    });
  } catch (error) {
    // A Check that cannot start (the fan-out cap) never holds the reply back.
    if (error instanceof SwarmToolError) return null;
    throw error;
  }
}
