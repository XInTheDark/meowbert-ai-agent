export interface ScratchCandidate {
  id: string;
  workspaceId: string;
  idleSince: number;
  sizeBytes: number | null;
}

export interface ScratchEvictionPolicy {
  highWatermark: number;
  targetWatermark: number;
  minIdleMinutes: number;
  maxIdleDays: number;
}

export const DEFAULT_SCRATCH_EVICTION_POLICY: ScratchEvictionPolicy = {
  highWatermark: 0.85,
  targetWatermark: 0.7,
  minIdleMinutes: 60,
  maxIdleDays: 14
};

export function scratchNeedsCleanup(used: number, available: number, capacity: number, budget: number, watermark: number): boolean {
  return used > budget * watermark || available < capacity * (1 - watermark);
}

export function rankScratchCandidates(
  candidates: ScratchCandidate[],
  workspaceBytes: Map<string, number>,
  budgetBytes: number,
  nowMs: number,
  minIdleMs: number
): ScratchCandidate[] {
  const fairShare = budgetBytes / Math.max(1, workspaceBytes.size);
  const score = (task: ScratchCandidate): number => {
    const weight = (workspaceBytes.get(task.workspaceId) ?? 0) > fairShare ? 2 : 1;
    // Legacy/non-XFS scratch has no size. Rank these by age, without inventing a large size.
    return (task.sizeBytes ?? 1) * Math.max(0, nowMs - task.idleSince) * weight;
  };
  return candidates.filter((task) => nowMs - task.idleSince >= minIdleMs)
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
}
