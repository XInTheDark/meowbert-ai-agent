import type { WastedTurnKind } from "@meowbert/shared";

export const WASTED_TURN_LOG_STAGES = ["run.turn.no_action", "run.turn.plain_text"] as const;

// Classifies one turn-diagnostic log. Runs logged before incompleteReason existed show the
// output-limit case only as a reasoning-only turn.
export function classifyWastedTurn(payload: {
  stage?: unknown;
  incompleteReason?: unknown;
  outputTypes?: unknown;
}): WastedTurnKind {
  if (payload.stage === "run.turn.plain_text") return "plain_text";
  if (payload.incompleteReason === "max_output_tokens") return "output_limit";
  const outputTypes = Array.isArray(payload.outputTypes) ? payload.outputTypes : [];
  if (outputTypes.length > 0 && outputTypes.every((type) => type === "reasoning")) return "reasoning_only";
  return "empty";
}
