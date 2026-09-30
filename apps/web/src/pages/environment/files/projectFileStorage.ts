import type { StorageSummary } from "../../../lib/types";
import { formatBytes } from "../../../lib/utils";

export interface ProjectFileStorageMetrics {
  usedBytes: number;
  limitBytes: number | null;
  usagePercent: number | null;
  meterPercent: number;
  remainingBytes: number | null;
  hasLimit: boolean;
  label: string;
  tooltip: string;
}

export function getProjectFileStorageMetrics(storage: StorageSummary | null): ProjectFileStorageMetrics {
  const usedBytes = storage?.usedBytes ?? 0;
  const limitBytes = storage && typeof storage.limitBytes === "number" ? storage.limitBytes : null;
  const rawUsagePercent = storage && typeof storage.usagePercent === "number" ? storage.usagePercent : null;
  const hasLimit = limitBytes !== null && limitBytes > 0;
  const usagePercent = rawUsagePercent !== null ? Math.round(rawUsagePercent) : null;
  const meterPercent = rawUsagePercent !== null ? Math.max(0, Math.min(100, Math.round(rawUsagePercent))) : 0;
  const remainingBytes = hasLimit ? limitBytes - usedBytes : null;
  const label = hasLimit
    ? `${usagePercent !== null ? String(usagePercent) : "--"}% used (${formatBytes(usedBytes)} / ${formatBytes(limitBytes)})`
    : storage
      ? `Used ${formatBytes(usedBytes)} (no limit)`
      : "Storage unavailable";
  const tooltip = hasLimit
    ? [
        `Storage ${formatBytes(usedBytes)} / ${formatBytes(limitBytes)}`,
        usagePercent !== null ? `${usagePercent}% used` : null,
        remainingBytes !== null
          ? remainingBytes >= 0
            ? `${formatBytes(remainingBytes)} free`
            : `${formatBytes(Math.abs(remainingBytes))} over limit`
          : null
      ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0).join(" • ")
    : label;

  return { usedBytes, limitBytes, usagePercent, meterPercent, remainingBytes, hasLimit, label, tooltip };
}
