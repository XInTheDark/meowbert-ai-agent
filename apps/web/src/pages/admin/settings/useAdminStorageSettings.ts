import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { FlashMessage } from "../../../lib/types";
import { buildWorkspaceBackendDrafts } from "./storage-drafts";
import type {
  AdminStorageBackendSummary,
  AdminStorageBackendTestResponse,
  AdminStorageResponse,
  AdminStorageUserSearchResponse,
  AdminStorageUserSummary,
  AdminSettingsTabKey
} from "./shared";

interface UseAdminStorageSettingsInput {
  api: ApiClient;
  activeTab: AdminSettingsTabKey;
  isSuperAdmin: boolean;
  setError: (error: string | null) => void;
  setFlash: (flash: FlashMessage | null) => void;
}

function useAdminStorageState() {
  const [storageOverview, setStorageOverview] = useState<AdminStorageResponse["storage"] | null>(null);
  const [defaultStorageBackendDraft, setDefaultStorageBackendDraft] = useState("");
  const [migrateExistingOnDefaultChange, setMigrateExistingOnDefaultChange] = useState(false);
  const [workspaceBackendDrafts, setWorkspaceBackendDrafts] = useState<Record<string, string>>({});
  const [testingStorageBackendId, setTestingStorageBackendId] = useState<string | null>(null);
  const [isStorageSaving, setIsStorageSaving] = useState(false);

  function applyStorageOverview(nextStorage: AdminStorageResponse["storage"]): void {
    setStorageOverview(nextStorage);
    setDefaultStorageBackendDraft(nextStorage.defaultWorkspaceBackendId);
    setWorkspaceBackendDrafts((previousDrafts) => buildWorkspaceBackendDrafts(nextStorage, previousDrafts));
  }

  function applyStorageBackendSummary(nextBackend: AdminStorageBackendSummary): void {
    setStorageOverview((previousStorage) => previousStorage ? {
      ...previousStorage,
      backends: previousStorage.backends.map((backend) => backend.id === nextBackend.id ? nextBackend : backend)
    } : previousStorage);
  }

  return {
    storageOverview,
    defaultStorageBackendDraft,
    setDefaultStorageBackendDraft,
    migrateExistingOnDefaultChange,
    setMigrateExistingOnDefaultChange,
    workspaceBackendDrafts,
    setWorkspaceBackendDrafts,
    testingStorageBackendId,
    setTestingStorageBackendId,
    isStorageSaving,
    setIsStorageSaving,
    applyStorageOverview,
    applyStorageBackendSummary
  };
}

function useAdminStorageUserSearch(
  api: ApiClient,
  setError: (error: string | null) => void,
  reloadStorageOverview: (ownerUserId?: string | null) => Promise<void>
) {
  const [storageUserSearchDraft, setStorageUserSearchDraft] = useState("");
  const [storageUserSearchResults, setStorageUserSearchResults] = useState<AdminStorageUserSummary[]>([]);
  const [selectedStorageUser, setSelectedStorageUser] = useState<AdminStorageUserSummary | null>(null);
  const [hasSearchedStorageUsers, setHasSearchedStorageUsers] = useState(false);
  const [isSearchingStorageUsers, setIsSearchingStorageUsers] = useState(false);
  const [isLoadingSelectedStorageUserWorkspaces, setIsLoadingSelectedStorageUserWorkspaces] = useState(false);

  async function searchStorageUsers(): Promise<void> {
    const search = storageUserSearchDraft.trim();
    if (!search) {
      setError("Enter a user email first.");
      return;
    }
    setError(null);
    setIsSearchingStorageUsers(true);
    try {
      const params = new URLSearchParams({ search, limit: "10" });
      const response = await api.get<AdminStorageUserSearchResponse>(`/api/admin/storage/users?${params.toString()}`);
      setStorageUserSearchResults(response.users);
      setHasSearchedStorageUsers(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSearchingStorageUsers(false);
    }
  }

  function clearStorageUserSearch(): void {
    setStorageUserSearchDraft("");
    setStorageUserSearchResults([]);
    setHasSearchedStorageUsers(false);
  }

  async function selectStorageUserForStorage(userSummary: AdminStorageUserSummary): Promise<void> {
    const previous = selectedStorageUser;
    setSelectedStorageUser(userSummary);
    setStorageUserSearchDraft(userSummary.email);
    setError(null);
    setIsLoadingSelectedStorageUserWorkspaces(true);
    try {
      await reloadStorageOverview(userSummary.id);
    } catch (error) {
      setSelectedStorageUser(previous);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingSelectedStorageUserWorkspaces(false);
    }
  }

  async function clearSelectedStorageUserForStorage(): Promise<void> {
    const previous = selectedStorageUser;
    setError(null);
    setIsLoadingSelectedStorageUserWorkspaces(true);
    try {
      await reloadStorageOverview(null);
      setSelectedStorageUser(null);
    } catch (error) {
      setSelectedStorageUser(previous);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingSelectedStorageUserWorkspaces(false);
    }
  }

  return {
    storageUserSearchDraft,
    setStorageUserSearchDraft,
    storageUserSearchResults,
    selectedStorageUser,
    hasSearchedStorageUsers,
    isSearchingStorageUsers,
    isLoadingSelectedStorageUserWorkspaces,
    searchStorageUsers,
    clearStorageUserSearch,
    selectStorageUserForStorage,
    clearSelectedStorageUserForStorage
  };
}

function useAdminStorageConfigurationActions(
  input: UseAdminStorageSettingsInput,
  state: ReturnType<typeof useAdminStorageState>,
  reloadStorageOverview: (ownerUserId?: string | null) => Promise<void>
) {
  const { api, setError, setFlash } = input;

  async function saveDefaultStorageBackend(): Promise<void> {
    const nextBackendId = state.defaultStorageBackendDraft.trim();
    if (!nextBackendId) {
      setError("Select a default storage backend first.");
      return;
    }
    setError(null);
    state.setIsStorageSaving(true);
    try {
      await api.patch("/api/admin/storage/default-backend", { backendId: nextBackendId });
      let migrationSummary = "";
      if (state.migrateExistingOnDefaultChange) {
        const result = await api.post<{ queuedCount: number; skippedWorkspaceIds: string[] }>(
          "/api/admin/storage/migrations/bulk",
          { targetBackendId: nextBackendId }
        );
        const skippedCount = result.skippedWorkspaceIds.length;
        migrationSummary = result.queuedCount > 0 || skippedCount > 0
          ? ` Queued ${result.queuedCount} workspace migration${result.queuedCount === 1 ? "" : "s"}${skippedCount > 0 ? `; skipped ${skippedCount}.` : "."}`
          : " No workspace migrations were needed.";
      }
      await reloadStorageOverview();
      state.setMigrateExistingOnDefaultChange(false);
      setFlash({ tone: "success", text: `Default workspace storage backend saved.${migrationSummary}` });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      state.setIsStorageSaving(false);
    }
  }

  async function testStorageBackend(backendId: string): Promise<void> {
    setError(null);
    state.setTestingStorageBackendId(backendId);
    try {
      const response = await api.post<AdminStorageBackendTestResponse>(`/api/admin/storage/backends/${backendId}/test`);
      state.applyStorageBackendSummary(response.backend);
      setFlash({
        tone: response.backend.healthState === "ready" ? "success" : "error",
        text: response.backend.healthState === "ready"
          ? `${response.backend.label} mounted successfully.`
          : `Mount test failed for ${response.backend.label}.`
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      state.setTestingStorageBackendId(null);
    }
  }

  return { saveDefaultStorageBackend, testStorageBackend };
}

function useAdminWorkspaceStorageMigration(
  input: UseAdminStorageSettingsInput,
  state: ReturnType<typeof useAdminStorageState>,
  reloadStorageOverview: (ownerUserId?: string | null) => Promise<void>
) {
  async function migrateWorkspaceStorage(workspaceId: string): Promise<void> {
    const targetBackendId = state.workspaceBackendDrafts[workspaceId]?.trim();
    if (!targetBackendId) {
      input.setError("Select a target storage backend first.");
      return;
    }
    input.setError(null);
    state.setIsStorageSaving(true);
    try {
      await input.api.post(`/api/admin/storage/workspaces/${workspaceId}/migrate`, { targetBackendId });
      await reloadStorageOverview();
      input.setFlash({ tone: "success", text: "Workspace storage migration queued." });
    } catch (error) {
      input.setError(error instanceof Error ? error.message : String(error));
    } finally {
      state.setIsStorageSaving(false);
    }
  }

  return { migrateWorkspaceStorage };
}

export function useAdminStorageSettings(input: UseAdminStorageSettingsInput) {
  const state = useAdminStorageState();

  async function loadStorageOverview(ownerUserId?: string | null): Promise<AdminStorageResponse["storage"]> {
    const params = new URLSearchParams();
    if (ownerUserId) {
      params.set("ownerUserId", ownerUserId);
    }
    const search = params.toString();
    const response = await input.api.get<AdminStorageResponse>(search ? `/api/admin/storage?${search}` : "/api/admin/storage");
    return response.storage;
  }

  async function reloadStorageOverview(ownerUserId?: string | null): Promise<void> {
    state.applyStorageOverview(await loadStorageOverview(ownerUserId));
  }

  const userSearch = useAdminStorageUserSearch(input.api, input.setError, reloadStorageOverview);
  const configuration = useAdminStorageConfigurationActions(input, state, () => (
    reloadStorageOverview(userSearch.selectedStorageUser?.id ?? null)
  ));
  const migration = useAdminWorkspaceStorageMigration(input, state, () => (
    reloadStorageOverview(userSearch.selectedStorageUser?.id ?? null)
  ));

  useEffect(() => {
    const activeCount = (state.storageOverview?.migrationActivity.queuedCount ?? 0)
      + (state.storageOverview?.migrationActivity.runningCount ?? 0);
    if (!input.isSuperAdmin || input.activeTab !== "storage" || activeCount === 0) {
      return;
    }
    let cancelled = false;
    const interval = setInterval(() => {
      void loadStorageOverview(userSearch.selectedStorageUser?.id ?? null)
        .then((storage) => {
          if (!cancelled) state.applyStorageOverview(storage);
        })
        .catch((error) => {
          if (!cancelled) console.error("[admin] Failed to refresh storage migration activity", error);
        });
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    input.activeTab,
    input.api,
    input.isSuperAdmin,
    state.storageOverview?.migrationActivity.queuedCount,
    state.storageOverview?.migrationActivity.runningCount,
    userSearch.selectedStorageUser?.id
  ]);

  return {
    ...state,
    ...userSearch,
    ...configuration,
    ...migration,
    loadStorageOverview
  };
}
