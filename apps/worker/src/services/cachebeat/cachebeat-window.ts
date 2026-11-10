import type { CachebeatSettings, TaskStatus } from "@meowbert/shared";

// Below this the whole conversation is cheap to write again, so it is not worth keeping warm.
const MIN_CONTEXT_TOKENS = 40_000;
// From this size on, a cache miss is expensive enough to keep the full window.
const FULL_CONTEXT_TOKENS = 100_000;

export interface CachebeatWindowInput {
  settings: CachebeatSettings;
  requestStartedAtMs: number;
  usedTokens: number;
  taskStatus: TaskStatus;
  // Someone has the task open right now.
  viewing: boolean;
  // When the task's schedule runs it next, if it has an active one.
  nextRunAtMs: number | null;
  nowMs: number;
  ttlMs: number;
}

// How likely the user is to continue: they were asked something, the task finished, or it stopped.
function statusWeight(status: TaskStatus): number {
  if (status === "awaiting_input") return 1;
  if (status === "succeeded") return 0.5;
  return 0.25;
}

function sizeWeight(usedTokens: number): number {
  return Math.min(1, Math.max(0.25, usedTokens / FULL_CONTEXT_TOKENS));
}

// When the cache should stop being kept warm. A result at or before the request means no beats.
export function resolveCachebeatWindowEnd(input: CachebeatWindowInput): number {
  const { settings, requestStartedAtMs } = input;
  const maxMs = settings.durationSeconds * 1000;
  if (settings.mode === "off") return requestStartedAtMs;
  if (settings.mode === "fixed") return requestStartedAtMs + maxMs;
  if (input.usedTokens < MIN_CONTEXT_TOKENS) return requestStartedAtMs;

  const capMs = requestStartedAtMs + maxMs;
  let endMs = requestStartedAtMs + maxMs * statusWeight(input.taskStatus) * sizeWeight(input.usedTokens);
  // While the task is on screen, stay warm through the next beat.
  if (input.viewing) endMs = Math.max(endMs, input.nowMs + input.ttlMs);
  // A scheduled run inside the limit reads the cache itself, so stay warm until it starts.
  if (input.nextRunAtMs !== null && input.nextRunAtMs <= capMs) endMs = Math.max(endMs, input.nextRunAtMs);
  return Math.min(endMs, capMs);
}
