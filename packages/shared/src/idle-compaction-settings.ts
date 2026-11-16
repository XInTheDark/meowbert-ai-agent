// How far idle compaction goes for top-level tasks. Standard compacts a task between runs while its
// prompt cache is still warm. Full also compacts inside a run whose next model request comes after the
// cache expired, such as after a long tool call, a swarm wait or a retry. The Project Master always
// gets at least Standard.
export const IDLE_COMPACTION_MODES = ["off", "standard", "full"] as const;
export type IdleCompactionMode = (typeof IDLE_COMPACTION_MODES)[number];

export const DEFAULT_IDLE_COMPACTION_MODE: IdleCompactionMode = "off";

export function normalizeIdleCompactionMode(value: unknown): IdleCompactionMode {
  return IDLE_COMPACTION_MODES.includes(value as IdleCompactionMode) ? value as IdleCompactionMode : DEFAULT_IDLE_COMPACTION_MODE;
}
