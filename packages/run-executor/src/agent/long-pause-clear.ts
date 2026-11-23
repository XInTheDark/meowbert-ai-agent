import { resolveIdleCompactionForModel } from "@meowbert/shared";
import type { PreparedAgentRunContext } from "./runtime.js";

// With Full idle compaction, the first request after a pause longer than the prompt cache's lifetime
// opens a fresh window (see expired-cache-compaction.ts).
export function resolveLongPauseClearSeconds(prepared: PreparedAgentRunContext): number | null {
  const { snapshot } = prepared;
  if (snapshot.idle_compaction_mode !== "full") return null;
  const settings = resolveIdleCompactionForModel(prepared.runtimeModel, snapshot.platform_model_metadata);
  return settings.enabled ? settings.promptCacheTtlSeconds : null;
}
