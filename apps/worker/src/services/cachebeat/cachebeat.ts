import { resolveIdleCompactionForModel, resolveModelTypeForModel } from "@meowbert/shared";
import { buildPromptCacheKey } from "@meowbert/run-executor/agent/turn-request";
import { resolveRuntimeAiProvider } from "../agent/runtime-provider.js";
import { hasNewerWorkOrFreshContext } from "../idle-compaction/idle-task.js";
import { loadLastModelRequest, type LastModelRequest } from "../idle-compaction/last-model-request.js";
import { planCachebeat, planCachebeatRetry, CACHEBEAT_RETRY_MS, type CachebeatPlan } from "./cachebeat-plan.js";
import { claimCachebeat, finishCachebeat, loadCachebeatState, recordCachebeatOutcome } from "./cachebeat-state.js";
import { loadCachebeatPlatformSettings, loadIdleCachebeatTask, type CachebeatPlatformSettings } from "./cachebeat-task.js";
import { resolveCachebeatWindowEnd } from "./cachebeat-window.js";
import { requestCacheBeat } from "./meridian-cache-beat.js";
import { isTaskBeingViewed } from "./task-viewers.js";

// - inactive: cachebeat does not apply to this task now;
// - beating: check the task again after the delay;
// - finished: the idle period's beats are over, and the cache was last read at that time.
export type CachebeatProgress =
  | { kind: "inactive" }
  | { kind: "beating"; checkInMs: number }
  | { kind: "finished"; cacheReadAtMs: number };

interface BeatContext {
  taskId: string;
  last: LastModelRequest & { prefixHash: string };
  ttlMs: number;
}

async function loadBeatContext(taskId: string, platform: CachebeatPlatformSettings): Promise<BeatContext | null> {
  if (platform.cachebeat.mode === "off") return null;
  const last = await loadLastModelRequest(taskId);
  if (!last || last.prefixHash === null) return null;
  // Only Claude sessions resumed through Meridian keep a cache a beat can refresh.
  if (resolveModelTypeForModel(last.model, platform.modelMetadata) !== "claude") return null;
  if (await hasNewerWorkOrFreshContext(null, taskId)) return null;
  const ttlMs = resolveIdleCompactionForModel(last.model, platform.modelMetadata).promptCacheTtlSeconds * 1000;
  return { taskId, last: { ...last, prefixHash: last.prefixHash }, ttlMs };
}

async function planNextStep(context: BeatContext, platform: CachebeatPlatformSettings, cacheReadAtMs: number): Promise<CachebeatPlan | null> {
  const task = await loadIdleCachebeatTask(context.taskId);
  if (!task) return null;
  const nowMs = Date.now();
  const windowEndMs = resolveCachebeatWindowEnd({
    settings: platform.cachebeat,
    requestStartedAtMs: context.last.startedAtMs,
    usedTokens: context.last.usedTokens,
    taskStatus: task.status,
    viewing: platform.cachebeat.mode === "smart" && await isTaskBeingViewed(context.taskId),
    nextRunAtMs: task.nextRunAtMs,
    nowMs,
    ttlMs: context.ttlMs
  });
  return planCachebeat({ nowMs, cacheReadAtMs, ttlMs: context.ttlMs, windowEndMs });
}

// Sends one beat and decides what follows from its outcome.
async function beat(context: BeatContext, cacheReadAtMs: number): Promise<CachebeatProgress> {
  const startedAtMs = context.last.startedAtMs;
  if (!await claimCachebeat(context.taskId, startedAtMs)) return { kind: "beating", checkInMs: CACHEBEAT_RETRY_MS };
  const provider = await resolveRuntimeAiProvider();
  const beatStartedAtMs = Date.now();
  const outcome = await requestCacheBeat(provider, buildPromptCacheKey(context.taskId, context.last.prefixHash));
  if (outcome === "reached") {
    await recordCachebeatOutcome({ taskId: context.taskId, requestStartedAtMs: startedAtMs, outcome, reachedAtMs: beatStartedAtMs, finished: false });
    return { kind: "beating", checkInMs: 0 };
  }
  const retry = outcome === "retry" || outcome === "busy"
    ? planCachebeatRetry({ nowMs: Date.now(), cacheReadAtMs, ttlMs: context.ttlMs })
    : { kind: "done" as const };
  const finished = retry.kind !== "wait";
  await recordCachebeatOutcome({ taskId: context.taskId, requestStartedAtMs: startedAtMs, outcome, reachedAtMs: null, finished });
  return finished ? { kind: "finished", cacheReadAtMs } : { kind: "beating", checkInMs: retry.delayMs };
}

// Keeps an idle Claude task's prompt cache warm until its cachebeat window ends. Idle compaction
// waits for this to finish, so it still reads a warm cache.
export async function advanceCachebeat(taskId: string): Promise<CachebeatProgress> {
  const platform = await loadCachebeatPlatformSettings();
  const context = await loadBeatContext(taskId, platform);
  if (!context) return { kind: "inactive" };
  const state = await loadCachebeatState(taskId, context.last.startedAtMs);
  if (state.finished) return { kind: "finished", cacheReadAtMs: state.cacheReadAtMs };

  const plan = await planNextStep(context, platform, state.cacheReadAtMs);
  if (!plan) return { kind: "inactive" };
  if (plan.kind === "wait") return { kind: "beating", checkInMs: plan.delayMs };
  if (plan.kind === "done") {
    await finishCachebeat(taskId, context.last.startedAtMs, "window_ended");
    return { kind: "finished", cacheReadAtMs: state.cacheReadAtMs };
  }
  return beat(context, state.cacheReadAtMs);
}
