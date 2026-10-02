import fsPromises from "node:fs/promises";
import path from "node:path";
import { calculatePathUsageBytes } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { toIsoTimestamp } from "../files/file-paths.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EnvironmentCleanupSuggestion {
  relativePath: string;
  taskId: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  sizeBytes: number;
  modifiedAt: string | null;
  ageDays: number;
  heuristicScore: number;
}

export interface EnvironmentCleanupPlan {
  targetPercent: number;
  targetBytes: number;
  reclaimableBytes: number;
  suggestedBytes: number;
  suggestions: EnvironmentCleanupSuggestion[];
}

export interface EnvironmentCleanupFilters {
  modifiedAfter?: string | null;
  modifiedBefore?: string | null;
  minSizeBytes?: number | null;
  maxSizeBytes?: number | null;
}

interface CandidateMetadata {
  title: string | null;
  status: string;
  updated_at: string;
  completed_at: string | null;
}

interface CleanupCandidate {
  relativePath: string;
  taskId: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  sizeBytes: number;
  modifiedAt: string | null;
  ageMs: number;
  heuristicScore: number;
}

interface NormalizedCleanupFilters {
  modifiedAfterMs: number | null;
  modifiedBeforeMs: number | null;
  minSizeBytes: number | null;
  maxSizeBytes: number | null;
}

function clampTargetPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.min(100, Math.max(1, Math.round(value)));
}

function isTaskDirName(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function parseDateBoundary(value: string | null | undefined, boundary: "start" | "end"): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Date.parse(`${trimmed}${boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z"}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCleanupFilters(filters?: EnvironmentCleanupFilters): NormalizedCleanupFilters {
  const minSizeBytes = typeof filters?.minSizeBytes === "number" && Number.isFinite(filters.minSizeBytes) && filters.minSizeBytes >= 0
    ? Math.floor(filters.minSizeBytes)
    : null;
  const maxSizeBytes = typeof filters?.maxSizeBytes === "number" && Number.isFinite(filters.maxSizeBytes) && filters.maxSizeBytes >= 0
    ? Math.floor(filters.maxSizeBytes)
    : null;

  return {
    modifiedAfterMs: parseDateBoundary(filters?.modifiedAfter, "start"),
    modifiedBeforeMs: parseDateBoundary(filters?.modifiedBefore, "end"),
    minSizeBytes,
    maxSizeBytes
  };
}

function matchesCleanupFilters(candidate: CleanupCandidate, filters: NormalizedCleanupFilters): boolean {
  if (filters.minSizeBytes !== null && candidate.sizeBytes < filters.minSizeBytes) {
    return false;
  }
  if (filters.maxSizeBytes !== null && candidate.sizeBytes > filters.maxSizeBytes) {
    return false;
  }

  if (filters.modifiedAfterMs !== null || filters.modifiedBeforeMs !== null) {
    const modifiedMs = candidate.modifiedAt ? Date.parse(candidate.modifiedAt) : Number.NaN;
    if (!Number.isFinite(modifiedMs)) {
      return false;
    }
    if (filters.modifiedAfterMs !== null && modifiedMs < filters.modifiedAfterMs) {
      return false;
    }
    if (filters.modifiedBeforeMs !== null && modifiedMs > filters.modifiedBeforeMs) {
      return false;
    }
  }

  return true;
}

async function loadTaskMetadata(environmentId: string, taskIds: string[]): Promise<Map<string, CandidateMetadata>> {
  if (taskIds.length === 0) {
    return new Map<string, CandidateMetadata>();
  }

  const result = await query<{
    id: string;
    title: string | null;
    status: string;
    updated_at: string;
    completed_at: string | null;
  }>(
    `SELECT id, title, status, updated_at, completed_at
       FROM tasks
      WHERE environment_id = $1
        AND id = ANY($2::uuid[])`,
    [environmentId, taskIds]
  );

  return new Map(result.rows.map((row) => [row.id, row]));
}

async function listCleanupCandidates(input: {
  environmentId: string;
  rootPath: string;
}): Promise<CleanupCandidate[]> {
  const taskRunsRoot = path.resolve(input.rootPath, ".meowbert", "task-runs");
  const entries = await fsPromises.readdir(taskRunsRoot, { withFileTypes: true }).catch(() => []);
  const directoryEntries = entries.filter((entry) => entry.isDirectory());
  const taskIds = directoryEntries.map((entry) => entry.name).filter(isTaskDirName);
  const metadataByTaskId = await loadTaskMetadata(input.environmentId, taskIds);
  const nowMs = Date.now();

  const rawCandidates = await Promise.all(
    directoryEntries.map(async (entry) => {
      const absolutePath = path.join(taskRunsRoot, entry.name);
      const stats = await fsPromises.stat(absolutePath).catch(() => null);
      if (!stats?.isDirectory()) {
        return null;
      }

      const taskId = isTaskDirName(entry.name) ? entry.name : null;
      const metadata = taskId ? metadataByTaskId.get(taskId) ?? null : null;
      if (metadata && ["running", "starting", "queued", "awaiting_input"].includes(metadata.status)) {
        return null;
      }

      const sizeBytes = await calculatePathUsageBytes(absolutePath);
      const recencySource = metadata?.completed_at ?? metadata?.updated_at ?? stats.mtime.toISOString();
      const recencyTimestamp = Date.parse(recencySource);
      const recencyMs = Number.isNaN(recencyTimestamp) ? stats.mtime.getTime() : recencyTimestamp;
      const ageMs = Math.max(0, nowMs - recencyMs);

      return {
        relativePath: path.posix.join(".meowbert", "task-runs", entry.name),
        taskId,
        taskTitle: metadata?.title ?? null,
        taskStatus: metadata?.status ?? null,
        sizeBytes,
        modifiedAt: toIsoTimestamp(new Date(recencyMs)),
        ageMs,
        heuristicScore: 0
      } satisfies CleanupCandidate;
    })
  );

  const candidates = rawCandidates.filter((entry): entry is CleanupCandidate => entry !== null);
  const maxSize = Math.max(...candidates.map((entry) => entry.sizeBytes), 0);
  const maxAgeMs = Math.max(...candidates.map((entry) => entry.ageMs), 0);

  return candidates
    .map((candidate) => {
      const sizeScore = maxSize > 0 ? candidate.sizeBytes / maxSize : 0;
      const ageScore = maxAgeMs > 0 ? candidate.ageMs / maxAgeMs : 0;
      return {
        ...candidate,
        heuristicScore: Math.round((sizeScore * 0.6 + ageScore * 0.4) * 1000) / 1000
      };
    })
    .sort((left, right) => {
      if (right.heuristicScore !== left.heuristicScore) {
        return right.heuristicScore - left.heuristicScore;
      }
      if (right.sizeBytes !== left.sizeBytes) {
        return right.sizeBytes - left.sizeBytes;
      }
      return left.relativePath.localeCompare(right.relativePath);
    });
}

export async function buildEnvironmentCleanupPlan(input: {
  environmentId: string;
  rootPath: string;
  targetPercent: number;
  filters?: EnvironmentCleanupFilters;
}): Promise<EnvironmentCleanupPlan> {
  const targetPercent = clampTargetPercent(input.targetPercent);
  const allCandidates = await listCleanupCandidates(input);
  const filters = normalizeCleanupFilters(input.filters);
  const candidates = allCandidates.filter((candidate) => matchesCleanupFilters(candidate, filters));
  const reclaimableBytes = candidates.reduce((total, entry) => total + entry.sizeBytes, 0);
  const targetBytes = Math.ceil(reclaimableBytes * (targetPercent / 100));

  if (candidates.length === 0 || targetBytes <= 0) {
    return {
      targetPercent,
      targetBytes,
      reclaimableBytes,
      suggestedBytes: 0,
      suggestions: []
    };
  }

  const suggestions: EnvironmentCleanupSuggestion[] = [];
  let suggestedBytes = 0;
  for (const candidate of candidates) {
    suggestions.push({
      relativePath: candidate.relativePath,
      taskId: candidate.taskId,
      taskTitle: candidate.taskTitle,
      taskStatus: candidate.taskStatus,
      sizeBytes: candidate.sizeBytes,
      modifiedAt: candidate.modifiedAt,
      ageDays: Math.round((candidate.ageMs / (1000 * 60 * 60 * 24)) * 10) / 10,
      heuristicScore: candidate.heuristicScore
    });
    if (suggestedBytes < targetBytes) {
      suggestedBytes += candidate.sizeBytes;
    }
  }

  return {
    targetPercent,
    targetBytes,
    reclaimableBytes,
    suggestedBytes,
    suggestions
  };
}
