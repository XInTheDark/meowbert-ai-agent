import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import type { FileDeleteResponse, ProjectCleanupPlanResponse, StorageSummary } from "../../../lib/types";
import { formatBytes } from "../../../lib/utils";
import { buildCleanupPlanQuery, buildDefaultCleanupSelection, EMPTY_CLEANUP_FILTERS, type CleanupFilterFormState } from "./projectFileCleanup";
import type { ProjectFileStorageMetrics } from "./projectFileStorage";

interface UseProjectFileCleanupOptions {
  projectId: string | null;
  workspaceId: string | null;
  projectRootPath: string | null;
  cwd: string;
  loadFiles: (path?: string) => Promise<void>;
  storageSummary: StorageSummary | null;
  storageMetrics: ProjectFileStorageMetrics;
  updateStorage: (summary: StorageSummary) => void;
  setError: Dispatch<SetStateAction<string | null>>;
}

function buildAiCleanupPrompt(options: UseProjectFileCleanupOptions): string {
  const storageLine = options.storageMetrics.hasLimit
    ? `Storage limit: ${formatBytes(options.storageMetrics.limitBytes)}. Current used: ${formatBytes(options.storageMetrics.usedBytes)}${options.storageMetrics.usagePercent !== null ? ` (${options.storageMetrics.usagePercent}%)` : ""}.`
    : options.storageSummary
      ? `Current used: ${formatBytes(options.storageMetrics.usedBytes)}. Storage limit: none.`
      : "Storage usage details are unavailable.";
  return [
    "Help me clean up this project.",
    `Project path: ${options.projectRootPath?.trim() || "unavailable"}.`,
    storageLine,
    "Do not delete anything directly.",
    "First inspect the project and suggest directories that are good cleanup candidates, with a short reason and the estimated space each one would free.",
    "Wait for my confirmation before removing any files or directories."
  ].join("\n");
}

export function useProjectFileCleanup(options: UseProjectFileCleanupOptions) {
  const { api, setFlash } = useWorkspaceApp();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<ProjectCleanupPlanResponse | null>(null);
  const [targetPercent, setTargetPercent] = useState(50);
  const [filters, setFilters] = useState<CleanupFilterFormState>({ ...EMPTY_CLEANUP_FILTERS });
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const selectedBytes = useMemo(() => plan?.suggestions
    .filter((entry) => selectedPaths.has(entry.relativePath))
    .reduce((total, entry) => total + entry.sizeBytes, 0) ?? 0, [plan, selectedPaths]);
  const defaultSelectionCount = useMemo(() => plan ? buildDefaultCleanupSelection(plan).size : 0, [plan]);

  const loadPlan = async (nextTarget = targetPercent, nextFilters = filters): Promise<void> => {
    if (!options.projectId) {
      return;
    }
    setIsLoading(true);
    options.setError(null);
    try {
      const result = await api.get<ProjectCleanupPlanResponse>(`/api/projects/${options.projectId}/files/cleanup?${buildCleanupPlanQuery(nextTarget, nextFilters)}`);
      setPlan(result);
      setTargetPercent(result.targetPercent);
      setSelectedPaths(buildDefaultCleanupSelection(result));
      options.updateStorage(result.storage);
    } catch (error) {
      options.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  const deletePaths = async (paths: string[]): Promise<void> => {
    if (!options.projectId || paths.length === 0 || !window.confirm(paths.length === 1 ? `Delete ${paths[0]} permanently? This cannot be undone.` : `Delete ${paths.length} selected item(s) permanently? This cannot be undone.`)) {
      return;
    }
    options.setError(null);
    try {
      const result = await api.post<FileDeleteResponse>(`/api/projects/${options.projectId}/files/delete`, { paths });
      options.updateStorage(result.storage);
      await options.loadFiles(options.cwd);
      if (plan) {
        await loadPlan(targetPercent, filters);
      }
      setFlash({ tone: "success", text: result.deletedCount === 1 ? "Deleted 1 item." : `Deleted ${result.deletedCount} items.` });
    } catch (error) {
      options.setError(error instanceof Error ? error.message : String(error));
    }
  };

  const startAiCleanup = async (): Promise<void> => {
    if (!options.projectId || !options.workspaceId) {
      return;
    }
    options.setError(null);
    try {
      const taskId = crypto.randomUUID();
      const created = await api.post<{ taskId: string }>(`/api/projects/${options.projectId}/tasks`, { taskId, message: buildAiCleanupPrompt(options) });
      navigate(`/app/${options.workspaceId}/projects/${options.projectId}/tasks/${created.taskId}`);
    } catch (error) {
      options.setError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    setPlan(null);
    setTargetPercent(50);
    setFilters({ ...EMPTY_CLEANUP_FILTERS });
    setSelectedPaths(new Set());
    setIsLoading(false);
  }, [options.projectId]);

  return { plan, targetPercent, setTargetPercent, filters, setFilters, selectedPaths, setSelectedPaths, isLoading, selectedBytes, defaultSelectionCount, loadPlan, deletePaths, startAiCleanup };
}
