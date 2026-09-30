import { useCallback, useEffect, useRef, useState } from "react";
import { selectPreferredContextUsage } from "@meowbert/shared/context-usage";
import type { ApiClient } from "../../../lib/api";
import { API_CACHE_TTLS } from "../../../lib/api-cache";
import { fetchTaskInlineFileTicket } from "../../../lib/taskInlineFiles";
import type { ProjectCanvasSummary, TaskArtifact, TaskArtifactsResponse, TaskDetail } from "../../../lib/types";

type UseTaskDetailDataOptions = {
  api: ApiClient;
  token: string | null;
  taskId: string;
  onTaskReset: () => void;
};

export function useTaskDetailData(options: UseTaskDetailDataOptions) {
  const {
    api,
    token,
    taskId,
    onTaskReset
  } = options;
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [isTaskLoading, setIsTaskLoading] = useState(true);
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null);
  const [conversationRefreshVersion, setConversationRefreshVersion] = useState(0);
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([]);
  const [artifactCanvases, setArtifactCanvases] = useState<ProjectCanvasSummary[]>([]);
  const [inlineFileTicket, setInlineFileTicket] = useState<string | null>(null);
  const [activeLeafMessageId, setActiveLeafMessageId] = useState<string | null>(null);
  const activeTaskIdRef = useRef(taskId);
  const previousTaskStatusRef = useRef<string | null>(null);
  const taskSnapshotRequestIdRef = useRef(0);
  const artifactRequestIdRef = useRef(0);
  const inlineFileTicketRequestIdRef = useRef(0);

  const loadTaskSnapshot = useCallback(async (input?: { forceFresh?: boolean }) => {
    if (!taskId) {
      return;
    }

    const taskSnapshotPath = `/api/tasks/${taskId}?messageDetail=none`;
    const requestId = taskSnapshotRequestIdRef.current + 1;
    taskSnapshotRequestIdRef.current = requestId;
    setTaskLoadError(null);
    try {
      if (input?.forceFresh) {
        api.invalidateGet?.({ path: taskSnapshotPath });
      }
      const snapshot = input?.forceFresh
        ? null
        : api.cachedGet?.<TaskDetail>(taskSnapshotPath, {
            ttlMs: API_CACHE_TTLS.taskDetail
          });
      const cachedTaskDetail = snapshot?.data ?? null;
      if (cachedTaskDetail && taskSnapshotRequestIdRef.current === requestId && activeTaskIdRef.current === taskId) {
        setTaskDetail((current) => {
          if (!current) {
            return cachedTaskDetail;
          }

          return {
            ...cachedTaskDetail,
            latest_context_usage: selectPreferredContextUsage(
              current.latest_context_usage ?? null,
              cachedTaskDetail.latest_context_usage ?? null
            )
          };
        });
        setActiveLeafMessageId(cachedTaskDetail.active_leaf_message_id ?? null);
        setIsTaskLoading(false);
      }

      const taskResponse = snapshot
        ? await snapshot.promise
        : await api.get<TaskDetail>(taskSnapshotPath);
      if (taskSnapshotRequestIdRef.current !== requestId || activeTaskIdRef.current !== taskId) {
        return;
      }
      api.primeGet?.(taskSnapshotPath, taskResponse);
      setTaskDetail((current) => {
        if (!current) {
          return taskResponse;
        }

        return {
          ...taskResponse,
          latest_context_usage: selectPreferredContextUsage(
            current.latest_context_usage ?? null,
            taskResponse.latest_context_usage ?? null
          )
        };
      });
      setActiveLeafMessageId(taskResponse.active_leaf_message_id ?? null);
      setIsTaskLoading(false);
    } catch (err) {
      if (taskSnapshotRequestIdRef.current !== requestId || activeTaskIdRef.current !== taskId) {
        return;
      }
      console.error(err);
      setTaskLoadError(err instanceof Error ? err.message : String(err));
      setIsTaskLoading(false);
    }
  }, [api, taskId]);

  const loadFreshTaskSnapshot = useCallback(() => loadTaskSnapshot({ forceFresh: true }), [loadTaskSnapshot]);

  const loadArtifacts = useCallback(async () => {
    if (!taskId) {
      return;
    }

    const requestId = artifactRequestIdRef.current + 1;
    artifactRequestIdRef.current = requestId;
    try {
      const snapshot = api.cachedGet?.<TaskArtifactsResponse>(`/api/tasks/${taskId}/artifacts`, {
        ttlMs: API_CACHE_TTLS.taskDetail
      });
      if (snapshot?.data && artifactRequestIdRef.current === requestId && activeTaskIdRef.current === taskId) {
        setArtifacts(snapshot.data.items);
        setArtifactCanvases(snapshot.data.canvases ?? []);
      }
      const artifactResponse = snapshot
        ? await snapshot.promise
        : await api.get<TaskArtifactsResponse>(`/api/tasks/${taskId}/artifacts`);
      if (artifactRequestIdRef.current !== requestId || activeTaskIdRef.current !== taskId) {
        return;
      }
      setArtifacts(artifactResponse.items);
      setArtifactCanvases(artifactResponse.canvases ?? []);
    } catch (err) {
      if (artifactRequestIdRef.current !== requestId || activeTaskIdRef.current !== taskId) {
        return;
      }
      console.error(err);
      setArtifacts([]);
      setArtifactCanvases([]);
    }
  }, [api, taskId]);

  const loadTask = useCallback(async (input?: { includeArtifacts?: boolean }) => {
    const snapshotPromise = loadTaskSnapshot();
    if (input?.includeArtifacts === false) {
      await snapshotPromise;
      return;
    }

    await Promise.allSettled([snapshotPromise, loadArtifacts()]);
  }, [loadArtifacts, loadTaskSnapshot]);

  useEffect(() => {
    activeTaskIdRef.current = taskId;
    previousTaskStatusRef.current = null;
    taskSnapshotRequestIdRef.current += 1;
    artifactRequestIdRef.current += 1;
    inlineFileTicketRequestIdRef.current += 1;
    setInlineFileTicket(null);
  }, [taskId]);

  useEffect(() => {
    if (!taskId || !token) {
      setInlineFileTicket(null);
      return;
    }

    const requestId = inlineFileTicketRequestIdRef.current + 1;
    inlineFileTicketRequestIdRef.current = requestId;

    void fetchTaskInlineFileTicket(taskId, token)
      .then((ticket) => {
        if (inlineFileTicketRequestIdRef.current !== requestId || activeTaskIdRef.current !== taskId) {
          return;
        }
        setInlineFileTicket(ticket);
      })
      .catch((err) => {
        if (inlineFileTicketRequestIdRef.current !== requestId || activeTaskIdRef.current !== taskId) {
          return;
        }
        console.error(err);
        setInlineFileTicket(null);
      });
  }, [taskId, token]);

  useEffect(() => {
    setTaskDetail(null);
    setIsTaskLoading(true);
    setTaskLoadError(null);
    setArtifacts([]);
    setArtifactCanvases([]);
    setActiveLeafMessageId(null);
    onTaskReset();
    void loadTask({ includeArtifacts: true });
  }, [loadTask, onTaskReset]);

  useEffect(() => {
    const nextStatus = taskDetail?.task.status ?? null;
    if (!nextStatus) {
      return;
    }

    const previousStatus = previousTaskStatusRef.current;
    previousTaskStatusRef.current = nextStatus;
    if (previousStatus && previousStatus !== "succeeded" && nextStatus === "succeeded") {
      setConversationRefreshVersion((current) => current + 1);
    }
  }, [taskDetail?.task.status]);

  return {
    taskDetail,
    setTaskDetail,
    isTaskLoading,
    setIsTaskLoading,
    taskLoadError,
    setTaskLoadError,
    conversationRefreshVersion,
    artifacts,
    artifactCanvases,
    loadArtifacts,
    loadTask,
    loadFreshTaskSnapshot,
    inlineFileTicket,
    activeLeafMessageId,
    setActiveLeafMessageId
  };
}
