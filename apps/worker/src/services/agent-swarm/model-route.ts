import {
  findPlatformModelRouterById,
  parseChosenModelRoute,
  reasoningScoreForEffort,
  type ChosenModelRoute,
  type ChosenModelRouteEffort,
  type PlatformModelRouter
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { extractModelRequestPayload } from "@meowbert/run-executor/agent/utils";
import { resolveChosenRoute } from "../model-routing/router-resolution.js";
import type { SubagentRuntime } from "@meowbert/run-executor/subagents/types";
import { SwarmToolError } from "./tool-error.js";

// A swarm preset may name a model router. With one, a parent picks each lane's model from the router's
// targets, the way the Project Master picks for the tasks it creates; without one every lane runs on
// the root model. A pick is stored on the lane and used for all its runs, with no routing call.

export function buildLaneModelRoute(
  router: PlatformModelRouter | null,
  modelId: string | null | undefined,
  effort: ChosenModelRouteEffort | null | undefined
): ChosenModelRoute | null {
  if (!router || !modelId) return null;
  if (!router.models.some((target) => target.id === modelId)) {
    throw new SwarmToolError(`Pick a lane model from: ${router.models.map((target) => target.id).join(", ")}, or null for your own.`);
  }
  return {
    routerId: router.id,
    modelId,
    reasoningScore: reasoningScoreForEffort(router.allowReasoningEffort ? effort ?? null : null)
  };
}

// The automatic Check should not share the author's blind spots, so it prefers a router target on a
// different model than the author's; with none, it runs on the root model.
export function pickCheckModelRoute(router: PlatformModelRouter | null, authorModel: string): ChosenModelRoute | null {
  const target = router?.models.find((candidate) => candidate.model !== authorModel);
  return router && target ? { routerId: router.id, modelId: target.id, reasoningScore: reasoningScoreForEffort(null) } : null;
}

export async function loadLaneModelRoute(laneTaskId: string): Promise<ChosenModelRoute | null> {
  const result = await query<{ model_route_json: unknown }>("SELECT model_route_json FROM task_swarm_lanes WHERE task_id = $1", [laneTaskId]);
  return parseChosenModelRoute(result.rows[0]?.model_route_json);
}

// A picked lane keeps the provider it was forked on and swaps in the target's model and payload.
// Router targets are platform models, so a lane on a bring-your-own provider keeps its own model.
export function applyLaneModelRoute(
  runtime: SubagentRuntime,
  route: ChosenModelRoute | null,
  routers: PlatformModelRouter[],
  environmentPayload: Record<string, unknown>
): SubagentRuntime {
  if (!route || runtime.provider.kind !== "platform") return runtime;
  const router = findPlatformModelRouterById(routers, route.routerId);
  if (!router) return runtime;
  const resolution = resolveChosenRoute(route, router, router.id, environmentPayload);
  return { ...runtime, model: resolution.resolvedModel, payload: extractModelRequestPayload(resolution.resolvedEnvironmentPayload) };
}
