import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ApiClient } from "../../../lib/api";
import { InlineProgressBar } from "../../../components/InlineProgressBar";
import { buildDefaultTaskAssistantMessageDisplayPreferences } from "../../../task/taskPagePreferences";
import type { SwarmChannelMessage, AgentSwarmWorkflowOverview, TaskDetail } from "../../../lib/types";
import { badgeClass, formatRelative, getEffectiveTaskStatus } from "../../../lib/utils";
import { TaskDetailConversationPane } from "./TaskDetailConversationPane";
import { formatSwarmAgentLabel } from "./swarmAgentLabel";

const WORKFLOW_MODAL_POLL_MS = 3000;

function formatSwarmMessageSenderLabel(message: SwarmChannelMessage): string {
  if (message.sender_task_id === null && message.sender_role === null) {
    return "System";
  }

  if (message.sender_role === "leader") {
    return "Leader";
  }

  if (message.sender_role === "worker" && typeof message.sender_slot_index === "number") {
    return `Worker ${message.sender_slot_index + 1}`;
  }

  if (message.sender_role === "reviewer" && typeof message.sender_slot_index === "number") {
    return `Reviewer ${message.sender_slot_index + 1}`;
  }

  if (typeof message.sender_role === "string" && message.sender_role.trim().length > 0) {
    return message.sender_role;
  }

  return "Unknown";
}

function WorkflowModalShell(props: {
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  wide?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  children: JSX.Element;
}): JSX.Element {
  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  const modal = (
    <div className="workflow-modal-overlay" onClick={props.onClose}>
      <div
        className={`workflow-modal${props.wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workflow-modal-header">
          <div style={{ minWidth: 0 }}>
            <h2>{props.title}</h2>
            {props.subtitle ? <p>{props.subtitle}</p> : null}
          </div>
          <button type="button" className="legal-close" onClick={props.onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div ref={props.bodyRef} className="workflow-modal-body">{props.children}</div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return modal;
  }

  return createPortal(modal, document.body);
}

function WorkflowPreformattedText(props: { value: string | null | undefined; emptyLabel: string }): JSX.Element {
  if (!props.value || props.value.trim().length === 0) {
    return <div className="muted-text">{props.emptyLabel}</div>;
  }

  return (
    <pre className="workflow-modal-preformatted">
      {props.value}
    </pre>
  );
}

export function WorkflowTextModal(props: {
  title: string;
  subtitle?: string | null;
  content: string | null | undefined;
  emptyLabel: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <WorkflowModalShell title={props.title} subtitle={props.subtitle} onClose={props.onClose}>
      <WorkflowPreformattedText value={props.content} emptyLabel={props.emptyLabel} />
    </WorkflowModalShell>
  );
}

export function SwarmChannelModal(props: {
  api: ApiClient;
  taskId: string;
  channel: AgentSwarmWorkflowOverview["agentSwarm"]["channels"][number];
  onClose: () => void;
}): JSX.Element {
  const [messages, setMessages] = useState<SwarmChannelMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const modalBodyRef = useRef<HTMLDivElement>(null);
  const initialScrollAppliedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadMessages = async () => {
      try {
        if (!cancelled) {
          setError(null);
          setIsLoading(true);
        }

        const response = await props.api.get<{ items: SwarmChannelMessage[] }>(
          `/api/tasks/${props.taskId}/workflow/channels/${props.channel.id}/messages`
        );
        if (cancelled) {
          return;
        }

        setMessages(response.items);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setMessages([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadMessages();
    const interval = window.setInterval(() => {
      void loadMessages();
    }, WORKFLOW_MODAL_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [props.api, props.channel.id, props.taskId]);

  useEffect(() => {
    initialScrollAppliedRef.current = false;
  }, [props.channel.id]);

  useEffect(() => {
    if (isLoading || error || initialScrollAppliedRef.current || !modalBodyRef.current) {
      return;
    }

    initialScrollAppliedRef.current = true;
    const body = modalBodyRef.current;
    const frameId = window.requestAnimationFrame(() => {
      body.scrollTo({ top: body.scrollHeight });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [error, isLoading, messages.length]);

  return (
    <WorkflowModalShell
      title={props.channel.title || "Channel"}
      subtitle={`${props.channel.kind} channel`}
      onClose={props.onClose}
      bodyRef={modalBodyRef}
    >
      <div className="workflow-modal-feed">
        {isLoading ? <InlineProgressBar pin="top" /> : null}
        {error ? <div className="error-text">{error}</div> : null}
        {!isLoading && !error && messages.length === 0 ? <div className="muted-text">No messages yet.</div> : null}
        {!error && messages.map((message) => (
          <article key={message.id} className="workflow-feed-card">
            <div className="workflow-feed-card-meta">
              <div style={{ display: "flex", gap: "0.45rem", alignItems: "center", flexWrap: "wrap" }}>
                <strong>{formatSwarmMessageSenderLabel(message)}</strong>
                <span className="badge muted">#{message.message_no}</span>
              </div>
              <span className="muted-text">{formatRelative(message.created_at)}</span>
            </div>
            <WorkflowPreformattedText value={message.content_markdown} emptyLabel="Empty message." />
          </article>
        ))}
      </div>
    </WorkflowModalShell>
  );
}

export function SwarmWorkerPovModal(props: {
  api: ApiClient;
  worker: AgentSwarmWorkflowOverview["agentSwarm"]["workers"][number];
  onClose: () => void;
}): JSX.Element {
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chatFeedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const loadWorkerTask = async () => {
      try {
        if (!cancelled) {
          setError(null);
        }
        const response = await props.api.get<TaskDetail>(`/api/tasks/${props.worker.task_id}?messageDetail=full`);
        if (cancelled) {
          return;
        }
        setTaskDetail(response);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setTaskDetail(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadWorkerTask();
    const interval = window.setInterval(() => {
      void loadWorkerTask();
    }, WORKFLOW_MODAL_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [props.api, props.worker.task_id]);

  useEffect(() => {
    if (!chatFeedRef.current) {
      return;
    }

    chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
  }, [taskDetail?.messages.length]);

  const displayStatus = useMemo(
    () => getEffectiveTaskStatus({
      taskStatus: taskDetail?.task.status ?? props.worker.status,
      cancellationRequested: taskDetail?.task.cancellation_requested,
      workflow: taskDetail?.workflow ?? null
    }),
    [props.worker.status, taskDetail?.task.cancellation_requested, taskDetail?.task.status, taskDetail?.workflow]
  );

  return (
    <WorkflowModalShell
      title={props.worker.title || formatSwarmAgentLabel(props.worker)}
      subtitle={formatSwarmAgentLabel(props.worker)}
      onClose={props.onClose}
      wide
    >
      <div className="workflow-worker-pov-shell">
        <div className="workflow-worker-pov-meta">
          <span className={`${badgeClass(displayStatus)} task-recurring-pill`}>{displayStatus}</span>
          {taskDetail?.task.updated_at ? <span className="muted-text">Updated {formatRelative(taskDetail.task.updated_at)}</span> : null}
        </div>
        {isLoading && !taskDetail ? <InlineProgressBar pin="top" /> : null}
        {error ? <div className="error-text">{error}</div> : null}
        {taskDetail ? (
          <div className="workflow-worker-pov-pane">
            <TaskDetailConversationPane
              taskId={taskDetail.task.id}
              messages={taskDetail.messages}
              assistantMessageDisplayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
              isConversationBootstrapping={false}
              isConversationPageLoading={false}
              conversationPageLoadDirection={null}
              isTaskRunning={false}
              isThinking={false}
              chatFeedRef={chatFeedRef}
              onScroll={() => {}}
              onConversationChanged={() => {}}
              onEditRequested={() => {}}
              renderBranchSwitcher={() => null}
              liveToolCalls={[]}
              interruptingLiveToolCallIds={[]}
              hydratedMessageIds={new Set(taskDetail.messages.map((message) => message.id))}
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
    </WorkflowModalShell>
  );
}
