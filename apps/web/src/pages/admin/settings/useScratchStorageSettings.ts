import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";

export interface ScratchStorageOverview {
  capacityBytes: number;
  usedBytes: number;
  availableBytes: number;
  limitMb: number | null;
  effectiveLimitBytes: number;
  highWatermark: number;
  targetWatermark: number;
  minIdleMinutes: number;
  maxIdleDays: number;
  finishedIdleDays: number;
  minFreeGb: number;
  // Null until the worker has measured, or when scratch has no XFS size accounting.
  usage: {
    measuredAt: string;
    activeBytes: number;
    idleBytes: number;
    untrackedBytes: number;
  } | null;
}

const endpoint = "/api/admin/host-storage/scratch";

export function useScratchStorageSettings(api: ApiClient, active: boolean) {
  const [overview, setOverview] = useState<ScratchStorageOverview | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const value = await api.get<ScratchStorageOverview>(endpoint);
      setOverview(value);
      setDraft(value.limitMb === null ? "" : String(value.limitMb));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally { setLoading(false); }
  }

  async function save() {
    const limitMb = draft.trim() === "" ? null : Number(draft);
    if (limitMb !== null && (!Number.isSafeInteger(limitMb) || limitMb <= 0 || (overview && limitMb * 1024 * 1024 > overview.capacityBytes))) {
      setError("Enter a positive whole number no larger than the backing capacity, or leave blank to use that capacity.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const value = await api.patch<ScratchStorageOverview>(endpoint, { limitMb });
      setOverview(value);
      setDraft(value.limitMb === null ? "" : String(value.limitMb));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  }

  useEffect(() => { if (active) void refresh(); }, [api, active]);
  return { overview, draft, setDraft, error, saving, loading, refresh, save };
}
