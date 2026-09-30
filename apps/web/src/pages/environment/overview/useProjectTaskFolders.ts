import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { TaskFolderListResponse, TaskFolderSummary } from "../../../lib/types";
import type { TaskFolderViewMode } from "./projectOverviewTypes";
import {
  readCollapsedTaskFolders,
  readTaskFolderViewMode,
  writeCollapsedTaskFolders,
  writeTaskFolderViewMode
} from "./projectOverviewPreferences";

export function useProjectTaskFolders(
  api: ApiClient,
  activeProjectId: string | null | undefined,
  refreshNonce: number
) {
  const [taskFolders, setTaskFolders] = useState<TaskFolderSummary[]>([]);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => readCollapsedTaskFolders(activeProjectId));
  const [folderViewMode, setFolderViewMode] = useState<TaskFolderViewMode>(() => readTaskFolderViewMode(activeProjectId));

  useEffect(() => {
    try {
      writeCollapsedTaskFolders(activeProjectId, collapsedFolderIds);
    } catch {
      // Ignore storage write failures.
    }
  }, [activeProjectId, collapsedFolderIds]);

  useEffect(() => {
    try {
      writeTaskFolderViewMode(activeProjectId, folderViewMode);
    } catch {
      // Ignore storage write failures.
    }
  }, [activeProjectId, folderViewMode]);

  useEffect(() => {
    setCollapsedFolderIds(readCollapsedTaskFolders(activeProjectId));
    setFolderViewMode(readTaskFolderViewMode(activeProjectId));
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setTaskFolders([]);
      return;
    }
    let cancelled = false;
    void api.get<TaskFolderListResponse>(`/api/projects/${activeProjectId}/task-folders`)
      .then((response) => {
        if (!cancelled) setTaskFolders(response.folders);
      })
      .catch(() => {
        if (!cancelled) setTaskFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, api, refreshNonce]);

  return { taskFolders, collapsedFolderIds, setCollapsedFolderIds, folderViewMode, setFolderViewMode };
}
