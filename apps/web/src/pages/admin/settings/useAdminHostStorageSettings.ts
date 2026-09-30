import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { FlashMessage } from "../../../lib/types";
import { formatBytes } from "../../../lib/utils";
import type {
  AdminHostStorageOverview,
  AdminHostStorageResponse,
  AdminSettingsTabKey,
  AdminTaskEventPruneResponse,
  AdminTaskEventsVacuumFullResponse,
  AdminTaskHistoryArchiveRunResponse,
  AdminTaskHistoryArchiveUpdateResponse
} from "./shared";

interface UseAdminHostStorageSettingsInput {
  api: ApiClient;
  activeTab: AdminSettingsTabKey;
  isSuperAdmin: boolean;
  setError: (error: string | null) => void;
  setFlash: (flash: FlashMessage | null) => void;
}

function useAdminHostStorageState(api: ApiClient) {
  const [overview, setOverview] = useState<AdminHostStorageOverview | null>(null);
  const [warmRetentionDaysDraft, setWarmRetentionDaysDraft] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingRetention, setIsSavingRetention] = useState(false);
  const [isPruningEvents, setIsPruningEvents] = useState(false);
  const [isVacuumingEvents, setIsVacuumingEvents] = useState(false);
  const [isQueueingArchive, setIsQueueingArchive] = useState(false);

  async function loadOverview(syncDraft = true): Promise<AdminHostStorageOverview> {
    const response = await api.get<AdminHostStorageResponse>("/api/admin/host-storage");
    setOverview(response.hostStorage);
    if (syncDraft) {
      setWarmRetentionDaysDraft(String(response.hostStorage.taskHistoryArchive.warmRetentionDays));
    }
    return response.hostStorage;
  }

  return {
    overview,
    warmRetentionDaysDraft,
    setWarmRetentionDaysDraft,
    isLoading,
    setIsLoading,
    isSavingRetention,
    setIsSavingRetention,
    isPruningEvents,
    setIsPruningEvents,
    isVacuumingEvents,
    setIsVacuumingEvents,
    isQueueingArchive,
    setIsQueueingArchive,
    loadOverview
  };
}

function useAdminHostStorageActions(
  input: UseAdminHostStorageSettingsInput,
  state: ReturnType<typeof useAdminHostStorageState>
) {
  const reportError = (error: unknown) => {
    input.setError(error instanceof Error ? error.message : String(error));
  };

  async function refreshOverview(): Promise<void> {
    input.setError(null);
    state.setIsLoading(true);
    try {
      await state.loadOverview();
    } catch (error) {
      reportError(error);
    } finally {
      state.setIsLoading(false);
    }
  }

  async function saveWarmRetentionDays(): Promise<void> {
    const value = state.warmRetentionDaysDraft.trim();
    const warmRetentionDays = Number(value);
    if (!value || !Number.isInteger(warmRetentionDays) || warmRetentionDays < 0 || warmRetentionDays > 3650) {
      input.setError("Warm retention days must be a whole number between 0 and 3650.");
      return;
    }
    input.setError(null);
    state.setIsSavingRetention(true);
    try {
      const response = await input.api.patch<AdminTaskHistoryArchiveUpdateResponse>(
        "/api/admin/host-storage/task-history",
        { warmRetentionDays }
      );
      state.setWarmRetentionDaysDraft(String(response.warmRetentionDays));
      await state.loadOverview();
      input.setFlash({
        tone: "success",
        text: response.warmRetentionDays > 0
          ? `Cold-storage retention saved to ${response.warmRetentionDays} day${response.warmRetentionDays === 1 ? "" : "s"}.`
          : "Automatic task-history archiving disabled."
      });
    } catch (error) {
      reportError(error);
    } finally {
      state.setIsSavingRetention(false);
    }
  }

  async function archiveNextEligibleTask(): Promise<void> {
    input.setError(null);
    state.setIsQueueingArchive(true);
    try {
      const response = await input.api.post<AdminTaskHistoryArchiveRunResponse>(
        "/api/admin/host-storage/task-history/archive"
      );
      await state.loadOverview(false);
      input.setFlash({
        tone: "success",
        text: response.run.status === "queued"
          ? "Cold-storage archive queued or will retry."
          : "Cold-storage archive request recorded."
      });
    } catch (error) {
      reportError(error);
    } finally {
      state.setIsQueueingArchive(false);
    }
  }

  return {
    refreshOverview,
    saveWarmRetentionDays,
    archiveNextEligibleTask
  };
}

function useAdminHostStorageMaintenanceActions(
  input: UseAdminHostStorageSettingsInput,
  state: ReturnType<typeof useAdminHostStorageState>
) {
  const reportError = (error: unknown) => {
    input.setError(error instanceof Error ? error.message : String(error));
  };

  async function pruneEventsNow(): Promise<void> {
    input.setError(null);
    state.setIsPruningEvents(true);
    try {
      const result = await input.api.post<AdminTaskEventPruneResponse>(
        "/api/admin/host-storage/events/prune"
      );
      await state.loadOverview(false);
      input.setFlash({
        tone: result.debugMode ? "error" : "success",
        text: result.debugMode
          ? "Event pruning is disabled while debug mode is on."
          : `Pruned ${result.deletedCount} excess task event${result.deletedCount === 1 ? "" : "s"}.`
      });
    } catch (error) {
      reportError(error);
    } finally {
      state.setIsPruningEvents(false);
    }
  }

  async function vacuumFullTaskEvents(): Promise<void> {
    const confirmed = window.confirm(
      "VACUUM FULL will exclusively lock task_events while PostgreSQL rewrites it. "
      + "Task event reads and writes will wait, and PostgreSQL may need temporary free disk close to the current table size. Continue?"
    );
    if (!confirmed) {
      return;
    }

    input.setError(null);
    state.setIsVacuumingEvents(true);
    try {
      const response = await input.api.post<AdminTaskEventsVacuumFullResponse>(
        "/api/admin/host-storage/events/vacuum-full",
        { confirmation: "VACUUM FULL task_events" }
      );
      await state.loadOverview(false);
      input.setFlash({
        tone: "success",
        text: `VACUUM FULL reclaimed ${formatBytes(response.result.reclaimedBytes)}; task_events is now ${formatBytes(response.result.afterBytes)}.`
      });
    } catch (error) {
      reportError(error);
    } finally {
      state.setIsVacuumingEvents(false);
    }
  }

  return {
    pruneEventsNow,
    vacuumFullTaskEvents
  };
}

export function useAdminHostStorageSettings(input: UseAdminHostStorageSettingsInput) {
  const state = useAdminHostStorageState(input.api);
  const actions = useAdminHostStorageActions(input, state);
  const maintenanceActions = useAdminHostStorageMaintenanceActions(input, state);

  useEffect(() => {
    if (!input.isSuperAdmin || input.activeTab !== "host-storage") {
      return;
    }
    void actions.refreshOverview();
  }, [input.activeTab, input.api, input.isSuperAdmin]);

  useEffect(() => {
    const hasActiveRun = state.overview?.taskHistoryArchive.recentRuns.some(
      (run) => run.status === "queued" || run.status === "running"
    ) ?? false;
    if (!input.isSuperAdmin || input.activeTab !== "host-storage" || !hasActiveRun) {
      return;
    }
    const interval = setInterval(() => {
      void state.loadOverview(false).catch((error) => {
        console.error("[admin] Failed to refresh host storage activity", error);
      });
    }, 5_000);
    return () => clearInterval(interval);
  }, [input.activeTab, input.api, input.isSuperAdmin, state.overview?.taskHistoryArchive.recentRuns]);

  return {
    ...state,
    ...actions,
    ...maintenanceActions
  };
}
