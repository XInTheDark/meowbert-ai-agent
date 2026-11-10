// Cachebeat keeps an idle Claude task's prompt cache warm after its last request, before idle
// compaction runs. Fixed beats for a set time; Smart picks a time up to that limit per task.
export const CACHEBEAT_MODES = ["off", "fixed", "smart"] as const;
export type CachebeatMode = (typeof CACHEBEAT_MODES)[number];

export interface CachebeatSettings {
  mode: CachebeatMode;
  // Fixed: how long to keep the cache warm. Smart: the longest it may stay warm.
  durationSeconds: number;
}

export const CACHEBEAT_MIN_DURATION_SECONDS = 60;
export const CACHEBEAT_MAX_DURATION_SECONDS = 24 * 60 * 60;
export const DEFAULT_CACHEBEAT_SETTINGS: CachebeatSettings = { mode: "off", durationSeconds: 2 * 60 * 60 };

// Where the API records who has a task open, read by the worker's Smart cachebeat.
export const TASK_VIEWERS_KEY_PREFIX = "task-viewers:";

export function normalizeCachebeatSettings(value: unknown): CachebeatSettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const mode = CACHEBEAT_MODES.includes(raw.mode as CachebeatMode) ? raw.mode as CachebeatMode : DEFAULT_CACHEBEAT_SETTINGS.mode;
  const duration = typeof raw.durationSeconds === "number" && Number.isFinite(raw.durationSeconds)
    ? Math.round(raw.durationSeconds)
    : DEFAULT_CACHEBEAT_SETTINGS.durationSeconds;
  return {
    mode,
    durationSeconds: Math.min(CACHEBEAT_MAX_DURATION_SECONDS, Math.max(CACHEBEAT_MIN_DURATION_SECONDS, duration))
  };
}
