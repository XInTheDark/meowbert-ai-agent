import { resolveIdleCompactionForModel } from "@meowbert/shared";
import type { PreparedAgentRunContext } from "./runtime.js";

// With Full idle compaction, the first request after a pause longer than the prompt cache's lifetime
// opens a fresh window (see expired-cache-compaction.ts). Lanes run on their seed and are never cleared.
export function resolveLongPauseClearSeconds(prepared: PreparedAgentRunContext, isLane: boolean): number | null {
  const { snapshot } = prepared;
  if (isLane || snapshot.idle_compaction_mode !== "full") return null;
  const settings = resolveIdleCompactionForModel(prepared.runtimeModel, snapshot.platform_model_metadata);
  return settings.enabled ? settings.promptCacheTtlSeconds : null;
}
