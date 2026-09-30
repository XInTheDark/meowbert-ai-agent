import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import { InlineProgressBar } from "../../../components/InlineProgressBar";
import { buildDefaultTaskAssistantMessageDisplayPreferences } from "../../../task/taskPagePreferences";
import type { TaskDetail } from "../../../lib/types";
import { badgeClass, formatRelative, getEffectiveTaskStatus } from "../../../lib/utils";
import { TaskDetailConversationPane } from "./TaskDetailConversationPane";

const WORKER_POLL_INTERVAL_MS = 3000;

interface TaskWorkflowWorkerPanelProps {
  api: ApiClient;
  workerTaskId: string;
  slotIndex: number;
  workerTitle: string | null;
  status: string;
}

export function TaskWorkflowWorkerPanel(props: TaskWorkflowWorkerPanelProps) {
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chatFeedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const loadWorkerTask = async () => {
      try {
        if (!cancelled) setError(null);
        const response = await props.api.get<TaskDetail>(
          `/api/tasks/${props.workerTaskId}?messageDetail=full`
        );
        if (cancelled) return;
        setTaskDetail(response);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setTaskDetail(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadWorkerTask();
    const interval = window.setInterval(() => {
      void loadWorkerTask();
    }, WORKER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [props.api, props.workerTaskId]);

  useEffect(() => {
    if (!chatFeedRef.current) return;
    chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
  }, [taskDetail?.messages.length]);

  const displayStatus = useMemo(
    () => getEffectiveTaskStatus({
      taskStatus: taskDetail?.task.status ?? props.status,
      cancellationRequested: taskDetail?.task.cancellation_requested,
      workflow: taskDetail?.workflow ?? null
    }),
    [props.status, taskDetail?.task.cancellation_requested, taskDetail?.task.status, taskDetail?.workflow]
  );

  return (
    <div className="workflow-worker-sidebar-pane">
      <div className="workflow-worker-meta-bar">
        <span className={`${badgeClass(displayStatus)} task-recurring-pill`}>{displayStatus}</span>
        {taskDetail?.task.updated_at ? (
          <span className="muted-text">Updated {formatRelative(taskDetail.task.updated_at)}</span>
        ) : null}
      </div>

      {isLoading && !taskDetail ? <InlineProgressBar pin="top" /> : null}
      {error ? <div className="error-text" style={{ padding: "0.8rem" }}>{error}</div> : null}

      {taskDetail ? (
        <div className="workflow-worker-feed-container">
          <TaskDetailConversationPane
            taskId={taskDetail.task.id}
            messages={taskDetail.messages}
            assistantMessageDisplayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
            isConversationBootstrapping={false}
            isConversationPageLoading={false}
            conversationPageLoadDirection={null}
            isTaskRunning={["running", "starting", "queued"].includes(taskDetail.task.status)}
            isThinking={false}
            chatFeedRef={chatFeedRef}
            onScroll={() => {}}
            onConversationChanged={() => {}}
            onEditRequested={() => {}}
            renderBranchSwitcher={() => null}
            liveToolCalls={[]}
            interruptingLiveToolCallIds={[]}
            hydratedMessageIds={new Set(taskDetail.messages.map((m) => m.id))}
            onToolGroupExpandRequested={() => {}}
            renderToolInspector
            isMobileViewport={false}
            isMobileInputExpanded={true}
            onMobileInputExpandedChange={() => {}}
            editingMessageId={null}
            onCancelEdit={() => {}}
            isBusy={false}
            followUp=""
            onFollowUpChange={() => {}}
            onSubmit={() => {}}
            attachments={[]}
            onRemoveAttachment={() => {}}
            onAttachFiles={() => {}}
            isUploading={false}
            pendingUploads={[]}
            toolOptions={{
              webSearch: false,
              memorySearch: false,
              scheduleTask: false,
              subtasks: false,
              computerUse: false,
              enabledSkills: [],
              enabledSources: []
            }}
            taskParameters={{
              schedule: { type: "standard", repeat: null, timezone: null, timeLimitSeconds: null },
              maxSteps: null,
              timeLimitSeconds: null,
              allowWaiting: true
            }}
            taskType={taskDetail.task.task_type}
            showMemorySearch={false}
            showComputerUse={false}
            onToolOptionsChange={() => {}}
            onTaskParametersChange={() => {}}
            onStop={() => {}}
            availableSkills={[]}
            availableSources={[]}
            attachableSources={[]}
            availableAgents={[]}
            selectedAgentId={null}
            defaultAgentId={null}
            onAgentChange={() => {}}
            showAgentSwitcher={false}
            errorText={null}
            hideComposer
            showMessageActions={false}
          />
        </div>
      ) : null}
    </div>
  );
}
