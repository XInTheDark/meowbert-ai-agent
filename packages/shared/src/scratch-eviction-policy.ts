export const SCRATCH_PRIORITIES = ["low", "normal", "high"] as const;
export type ScratchPriority = (typeof SCRATCH_PRIORITIES)[number];

// How finished the task owning the scratch is:
// "retired" lanes can never run again, "finished" tasks are done but may get a follow-up, "open" tasks await input.
export type ScratchCompletion = "retired" | "finished" | "open";

export interface ScratchCandidate {
  id: string;
  workspaceId: string;
  idleSince: number;
  sizeBytes: number | null;
  priority: ScratchPriority;
  completion: ScratchCompletion;
}

export interface ScratchEvictionPolicy {
  highWatermark: number;
  targetWatermark: number;
  minIdleMinutes: number;
  maxIdleDays: number;
  finishedIdleDays: number;
  minFreeGb: number;
}

export const DEFAULT_SCRATCH_EVICTION_POLICY: ScratchEvictionPolicy = {
  highWatermark: 0.85,
  targetWatermark: 0.7,
  minIdleMinutes: 60,
  maxIdleDays: 14,
  finishedIdleDays: 3,
  minFreeGb: 10
};

const DAY_MS = 86_400_000;
const LOW_PRIORITY_FINISHED_IDLE_DAYS = 1;
// The free-space floor never claims more than this share of the budget, so small disks still fill up.
const MAX_FLOOR_SHARE = 0.25;
// Cleanup that starts at the floor runs until this multiple of it is free.
const FLOOR_TARGET_MULTIPLIER = 1.5;

export interface ScratchSpace {
  usedBytes: number;
  availableBytes: number;
  capacityBytes: number;
  effectiveLimitBytes: number;
}

export function scratchFreeFloorBytes(space: ScratchSpace, minFreeGb: number): number {
  return Math.min(minFreeGb * 1024 ** 3, space.effectiveLimitBytes * MAX_FLOOR_SHARE);
}

// Pressure is any of: the budget filling past the watermark, the disk filling past it, or free space dropping under the floor.
export function scratchNeedsCleanup(space: ScratchSpace, watermark: number, floorBytes = 0): boolean {
  const { usedBytes, availableBytes, capacityBytes, effectiveLimitBytes } = space;
  const free = Math.min(availableBytes, effectiveLimitBytes - usedBytes);
  return usedBytes > effectiveLimitBytes * watermark || availableBytes < capacityBytes * (1 - watermark) || free < floorBytes;
}

export function scratchCleanupThresholds(space: ScratchSpace, policy: ScratchEvictionPolicy) {
  const floor = scratchFreeFloorBytes(space, policy.minFreeGb);
  return {
    start: (current: ScratchSpace) => scratchNeedsCleanup(current, policy.highWatermark, floor),
    keepGoing: (current: ScratchSpace) => scratchNeedsCleanup(current, policy.targetWatermark, floor * FLOOR_TARGET_MULTIPLIER)
  };
}

// How long scratch may sit idle before it is cleared without disk pressure. Null keeps it until pressure.
export function scratchIdleExpiryMs(task: Pick<ScratchCandidate, "priority" | "completion">, policy: ScratchEvictionPolicy): number | null {
  if (task.completion === "retired") return 0;
  if (task.priority === "high") return null;
  // A setting of 0 disables that expiry; low priority only shortens an enabled one.
  const cap = (days: number, limit: number) => (days > 0 ? Math.min(days, limit) : 0);
  const low = task.priority === "low";
  const days = task.completion === "finished"
    ? (low ? cap(policy.finishedIdleDays, LOW_PRIORITY_FINISHED_IDLE_DAYS) : policy.finishedIdleDays)
    : (low ? cap(policy.maxIdleDays, policy.finishedIdleDays || Infinity) : policy.maxIdleDays);
  return days > 0 ? days * DAY_MS : null;
}

const PRIORITY_WEIGHT: Record<ScratchPriority, number> = { low: 4, normal: 1, high: 1 };
const COMPLETION_WEIGHT: Record<ScratchCompletion, number> = { retired: 4, finished: 2, open: 1 };

export function rankScratchCandidates(
  candidates: ScratchCandidate[],
  workspaceBytes: Map<string, number>,
  budgetBytes: number,
  nowMs: number,
  minIdleMs: number
): ScratchCandidate[] {
  const fairShare = budgetBytes / Math.max(1, workspaceBytes.size);
  const score = (task: ScratchCandidate): number => {
    const fairWeight = (workspaceBytes.get(task.workspaceId) ?? 0) > fairShare ? 2 : 1;
    // Legacy/non-XFS scratch has no size. Rank these by age, without inventing a large size.
    return (task.sizeBytes ?? 1) * Math.max(0, nowMs - task.idleSince) * fairWeight
      * PRIORITY_WEIGHT[task.priority] * COMPLETION_WEIGHT[task.completion];
  };
  // High-priority projects are cleared only after every other candidate.
  const tier = (task: ScratchCandidate) => (task.priority === "high" ? 1 : 0);
  return candidates.filter((task) => nowMs - task.idleSince >= minIdleMs)
    .sort((a, b) => tier(a) - tier(b) || score(b) - score(a) || a.id.localeCompare(b.id));
}

export function normalizeScratchPriority(value: unknown): ScratchPriority {
  return (SCRATCH_PRIORITIES as readonly unknown[]).includes(value) ? value as ScratchPriority : "normal";
}
