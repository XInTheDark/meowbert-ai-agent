import {
  reasoningScoreForEffort,
  type ChosenModelRoute,
  type ChosenModelRouteEffort,
  type PlatformModelRouter
} from "@meowbert/shared";
import type { SubagentRuntime } from "../subagents/types.js";
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

// Whether a lane on this route runs on another model than the runtime it forks from. Router targets
// are platform models, so a lane on a bring-your-own provider stays on its parent's model.
export function routesToOtherModel(
  route: ChosenModelRoute | null,
  router: PlatformModelRouter | null,
  runtime: Pick<SubagentRuntime, "model" | "provider">
): boolean {
  if (!route || !router || runtime.provider.kind !== "platform") return false;
  const target = router.models.find((candidate) => candidate.id === route.modelId);
  return Boolean(target && target.model !== runtime.model);
}
