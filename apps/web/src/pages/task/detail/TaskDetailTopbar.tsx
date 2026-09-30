import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Bell,
  Bug,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Download,
  Eraser,
  FolderOpen,
  MessageSquare,
  Minimize2,
  MoreVertical,
  Package,
  PanelLeftOpen,
  Search,
  Terminal,
  Trash2
} from "lucide-react";
import type { TaskAssistantMessageDisplayPreferences, TaskDetail } from "../../../lib/types";
import { badgeClass, formatDateTime, formatRelative, formatTaskTypeLabel } from "../../../lib/utils";
import { TaskStatusBadge } from "../../../components/tasks/TaskStatusBadge";
import type { TaskDetailTab } from "./taskDetailConstants";
import { TaskDetailDisplaySettingsDropdown } from "./TaskDetailDisplaySettingsDropdown";
import { formatTokenCount } from "./taskDetailUtils";
import { SubscriptionUsageWarningLink, type SubscriptionUsageWarning } from "../../../subscription/usageLimits";
import { calculateContextUsagePercent } from "@meowbert/shared/context-usage";

interface TaskDetailTopbarProps {
  task: TaskDetail["task"];
  allTasksHref?: string;
  displayStatus?: string;
  subtasks: NonNullable<TaskDetail["subtasks"]>;
  isTaskRunning: boolean;
  isCompacting: boolean;
  isClearingContext: boolean;
  isScheduleActionBusy: boolean;
  topbarCollapsed: boolean;
  isMobileViewport: boolean;
  onExpandRequested: () => void;
  activeTab: TaskDetailTab;
  onTabChange: (nextTab: TaskDetailTab) => void;
  actionsMenuRef: RefObject<HTMLDivElement>;
  actionsMenuOpen: boolean;
  onActionsMenuToggle: () => void;
  onViewFiles: () => void;
  onOpenTaskFolder: () => void;
  canOpenTaskFolder: boolean;
  onExportJson: () => void;
  onExportMarkdown: () => void;
  isExportingChat: boolean;
  onCompactContext: () => void;
  onClearContext: () => void;
  contextChipExpanded: boolean;
  onContextChipExpandedChange: (expanded: boolean) => void;
  onPauseSchedule: () => void;
  onResumeSchedule: () => void;
  onRunNowSchedule: () => void;
  onOpenSubtask: (subtaskId: string) => void;
  latestContextUsage: TaskDetail["latest_context_usage"];
  messageDisplayPreferences: TaskAssistantMessageDisplayPreferences;
  onMessageDisplayPreferencesChange: (nextValue: TaskAssistantMessageDisplayPreferences) => void;
  isMessageDisplayPreferencesSaving: boolean;
  newMessageOrganizationEnabled?: boolean;
  isConversationOutlineOpen?: boolean;
  onConversationOutlineToggle?: () => void;
  isMessageOutlineOpen: boolean;
  onMessageOutlineToggle: () => void;
  onOpenMobileNavigation?: () => void;
  onOpenSearch?: () => void;
  onDeletePermanently?: () => void;
  isDeletingPermanently?: boolean;
  workflowStrip?: ReactNode;
  workflowPanel?: ReactNode;
  subscriptionUsageWarning?: SubscriptionUsageWarning | null;
  debugMode?: boolean;
  persistentShellCount?: number;
}

interface UsageSummary {
  usageTokens: number;
  usageMaxTokens: number;
  usagePercent: number;
  cacheHitPercent: number | null;
  cachedTokens: number | null;
  promptRevision: string | null;
  prefixHash: string | null;
}

function TaskMessageOutlineToggleIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="task-outline-toggle-icon"
    >
      <circle cx="5.5" cy="5.5" r="1.15" fill="currentColor" />
      <circle cx="5.5" cy="10" r="1.15" fill="currentColor" />
      <circle cx="5.5" cy="14.5" r="1.15" fill="currentColor" />
      <path d="M8.75 5.5h5.75" />
      <path d="M8.75 10h5.75" />
      <path d="M8.75 14.5h5.75" />
      <path d="M10 8.1v3.8" />
    </svg>
  );
}

function getDisplayStatus(task: TaskDetail["task"]): string {
  return task.cancellation_requested === true
    && (task.status === "queued" || task.status === "starting" || task.status === "running")
    ? "interrupting"
    : task.status;
}

function getUsageSummary(latestUsagePayload: TaskDetail["latest_context_usage"]): UsageSummary | null {
  const usageTokens =
    latestUsagePayload && typeof latestUsagePayload.usedTokens === "number"
      ? latestUsagePayload.usedTokens
      : null;
  const usageMaxTokens =
    latestUsagePayload && typeof latestUsagePayload.maxContextTokens === "number"
      ? latestUsagePayload.maxContextTokens
      : null;

  if (usageTokens === null || usageMaxTokens === null || usageMaxTokens <= 0) {
    return null;
  }

  const usagePercent = calculateContextUsagePercent(usageTokens, usageMaxTokens);
  const cachedTokens =
    latestUsagePayload && typeof latestUsagePayload.cachedTokens === "number"
      ? latestUsagePayload.cachedTokens
      : null;
  const cacheHitRatio =
    latestUsagePayload && typeof latestUsagePayload.cacheHitRatio === "number"
      ? latestUsagePayload.cacheHitRatio
      : cachedTokens !== null && usageTokens > 0
        ? Math.min(1, Math.max(0, cachedTokens / usageTokens))
        : null;

  return {
    usageTokens,
    usageMaxTokens,
    usagePercent,
    cacheHitPercent: cacheHitRatio !== null ? Math.round(cacheHitRatio * 100) : null,
    cachedTokens,
    promptRevision:
      latestUsagePayload && typeof latestUsagePayload.promptRevision === "string"
        ? latestUsagePayload.promptRevision
        : null,
    prefixHash:
      latestUsagePayload && typeof latestUsagePayload.prefixHash === "string"
        ? latestUsagePayload.prefixHash
        : null
  };
}

function TaskDetailUsageChip(props: {
  usage: UsageSummary | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const isExpanded = props.usage !== null && props.expanded;
  useDismissable(isExpanded, () => props.onExpandedChange(false), popoverRef);

  if (props.usage === null) {
    return (
      <span
        className="context-usage-pill unavailable"
        title="Context usage will appear after the provider reports input-token usage."
        aria-label="Context usage unavailable"
      >
        Context —
      </span>
    );
  }

  const usage = props.usage;

  const title = [
    `Context ${formatTokenCount(usage.usageTokens)} / ${formatTokenCount(usage.usageMaxTokens)} (${usage.usagePercent}%)`,
    usage.cacheHitPercent !== null && usage.cachedTokens !== null
      ? `Cache hit ${usage.cacheHitPercent}% (${formatTokenCount(usage.cachedTokens)} cached)`
      : null,
    usage.promptRevision ? `Revision ${usage.promptRevision}` : null,
    usage.prefixHash ? `Prefix ${usage.prefixHash}` : null
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join(" • ");

  const isWarning = usage.usagePercent >= 80;
  const isCritical = usage.usagePercent >= 95;

  return (
    <div className="task-detail-usage-container" ref={popoverRef}>
      <button
        type="button"
        className={`context-usage-pill ${isCritical ? "critical" : isWarning ? "warning" : ""} ${isExpanded ? "expanded" : ""}`}
        onClick={() => props.onExpandedChange(!isExpanded)}
        title={title}
        aria-expanded={isExpanded}
      >
        <span className="context-usage-pill-meter" aria-hidden="true">
          <span
            className="context-usage-pill-fill"
            style={{ width: `${Math.min(100, Math.max(0, usage.usagePercent))}%` }}
          />
        </span>
        <span className="context-usage-pill-text">Context {usage.usagePercent}%</span>
      </button>

      {isExpanded ? (
        <div className="context-usage-chip task-detail-usage-popover" role="dialog" aria-label="Context usage details">
          <div className="context-usage-label">
            Context {formatTokenCount(usage.usageTokens)} / {formatTokenCount(usage.usageMaxTokens)} ({usage.usagePercent}%)
          </div>
          {usage.cacheHitPercent !== null && usage.cachedTokens !== null ? (
            <div className="muted-text" style={{ fontSize: "0.75rem" }}>
              Cache hit {usage.cacheHitPercent}% ({formatTokenCount(usage.cachedTokens)} cached)
              {usage.promptRevision ? ` · ${usage.promptRevision}` : ""}
              {usage.prefixHash ? ` · ${usage.prefixHash}` : ""}
            </div>
          ) : null}
          <div className="context-usage-meter">
            <span
              style={{
                width: `${Math.min(100, Math.max(0, usage.usagePercent))}%`,
                background: isCritical
                  ? "var(--danger)"
                  : isWarning
                    ? "var(--warning)"
                    : "var(--brand)"
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskDetailActionsMenu(props: {
  actionsMenuRef: RefObject<HTMLDivElement>;
  actionsMenuOpen: boolean;
  onToggle: () => void;
  onViewFiles: () => void;
  onOpenTaskFolder: () => void;
  canOpenTaskFolder: boolean;
  onExportJson: () => void;
  onExportMarkdown: () => void;
  isExportingChat: boolean;
  onCompactContext: () => void;
  onClearContext: () => void;
  isTaskRunning: boolean;
  isCompacting: boolean;
  isClearingContext: boolean;
  onOpenSearch?: () => void;
  newMessageOrganizationEnabled?: boolean;
  isConversationOutlineOpen?: boolean;
  onConversationOutlineToggle?: () => void;
  isMessageOutlineOpen: boolean;
  onMessageOutlineToggle: () => void;
}) {
  return (
    <div className="topbar-dropdown" ref={props.actionsMenuRef}>
      <button
        type="button"
        className="task-topbar-icon-btn"
        onClick={props.onToggle}
        title="More actions"
        aria-label="More actions"
      >
        <MoreVertical size={16} />
      </button>
      {props.actionsMenuOpen ? (
        <div className="topbar-dropdown-menu">
          <button onClick={props.onMessageOutlineToggle} aria-pressed={props.isMessageOutlineOpen}>
            <TaskMessageOutlineToggleIcon /> {props.isMessageOutlineOpen ? "Hide Messages" : "Show Messages"}
          </button>
          {props.newMessageOrganizationEnabled ? <button onClick={props.onConversationOutlineToggle} aria-pressed={props.isConversationOutlineOpen}>
            <TaskMessageOutlineToggleIcon /> {props.isConversationOutlineOpen ? "Hide Outline" : "Show Outline"}
          </button> : null}
          {props.onOpenSearch ? (
            <button onClick={() => { props.onOpenSearch?.(); }}>
              <Search size={14} /> Search
            </button>
          ) : null}
          <button onClick={props.onViewFiles}>
            <FolderOpen size={14} /> View Files
          </button>
          {props.canOpenTaskFolder ? (
            <button onClick={props.onOpenTaskFolder}>
              <FolderOpen size={14} /> Open Task Folder
            </button>
          ) : null}
          <details className="topbar-dropdown-submenu">
            <summary>
              <Download size={14} />
              {props.isExportingChat ? "Exporting..." : "Export"}
              <ChevronRight size={13} className="topbar-dropdown-submenu-chevron" aria-hidden="true" />
            </summary>
            <div className="topbar-dropdown-submenu-panel">
              <button type="button" onClick={props.onExportJson} disabled={props.isExportingChat}>
                JSON
              </button>
              <button type="button" onClick={props.onExportMarkdown} disabled={props.isExportingChat}>
                Markdown
              </button>
            </div>
          </details>
          <button onClick={props.onCompactContext} disabled={props.isTaskRunning || props.isCompacting || props.isClearingContext}>
            <Minimize2 size={14} /> {props.isCompacting ? "Compacting..." : "Compact Context"}
          </button>
          <button onClick={props.onClearContext} disabled={props.isTaskRunning || props.isCompacting || props.isClearingContext}>
            <Eraser size={14} /> {props.isClearingContext ? "Clearing..." : "Clear Context"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Closes a popover on outside pointer events and Escape. */
function useDismissable(open: boolean, onDismiss: () => void, ref: RefObject<HTMLDivElement>): void {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (target && !ref.current?.contains(target)) {
        onDismiss();
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onDismiss();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onDismiss, ref]);
}

/**
 * Schedule state as a chip in the title row, with the full cadence detail and the
 * pause/resume/run controls behind a popover. Previously this was a permanent strip
 * that pushed the conversation down by a whole row.
 */
function TaskDetailScheduleChip(props: {
  task: TaskDetail["task"];
  isScheduleActionBusy: boolean;
  onPauseSchedule: () => void;
  onResumeSchedule: () => void;
  onRunNowSchedule: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismissable(open, () => setOpen(false), rootRef);

  const recurringSchedule = props.task.schedule ?? null;
  if (!recurringSchedule) {
    return null;
  }

  const isTimedTask =
    props.task.task_type === "timed"
    || (recurringSchedule.mode === "infinite" && recurringSchedule.run_timeout_seconds !== null);
  const timedMinutes =
    recurringSchedule.run_timeout_seconds && recurringSchedule.run_timeout_seconds > 0
      ? Math.ceil(recurringSchedule.run_timeout_seconds / 60)
      : null;
  const nextRunLabel = recurringSchedule.next_run_at
    ? formatRelative(recurringSchedule.next_run_at)
    : "not scheduled";

  return (
    <div className="task-schedule-chip-wrap" ref={rootRef}>
      <button
        type="button"
        className={`task-schedule-chip ${badgeClass(recurringSchedule.state)}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${recurringSchedule.state} · ${isTimedTask ? "next wake-up" : "next run"} ${nextRunLabel}`}
      >
        <CalendarClock size={13} aria-hidden="true" />
        <span>{recurringSchedule.state}</span>
        <span className="task-schedule-chip-next">{nextRunLabel}</span>
        {recurringSchedule.pending_run ? <span className="task-schedule-chip-pending" aria-label="pending run" /> : null}
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {open ? (
        <div className="task-schedule-popover" role="dialog" aria-label="Schedule">
          <dl className="task-schedule-facts">
            <div>
              <dt>Timezone</dt>
              <dd>{recurringSchedule.timezone ?? props.task.default_timezone ?? "UTC"}</dd>
            </div>
            {recurringSchedule.mode === "scheduled" && recurringSchedule.repeat ? (
              <div>
                <dt>Repeat</dt>
                <dd><code>{recurringSchedule.repeat}</code></dd>
              </div>
            ) : isTimedTask ? (
              <div>
                <dt>Timed run limit</dt>
                <dd>{timedMinutes ? `${timedMinutes} min` : "set"}</dd>
              </div>
            ) : (
              <div>
                <dt>Cadence</dt>
                <dd>
                  wait-driven loop
                  {recurringSchedule.run_timeout_seconds
                    ? ` (${Math.ceil(recurringSchedule.run_timeout_seconds / 60)} min limit)`
                    : ""}
                </dd>
              </div>
            )}
            <div>
              <dt>{isTimedTask ? "Next wake-up" : "Next run"}</dt>
              <dd>{recurringSchedule.next_run_at ? formatDateTime(recurringSchedule.next_run_at) : "not scheduled"}</dd>
            </div>
            {recurringSchedule.run_deadline_at ? (
              <div>
                <dt>Deadline</dt>
                <dd>{formatDateTime(recurringSchedule.run_deadline_at)}</dd>
              </div>
            ) : null}
            {recurringSchedule.pending_run ? (
              <div>
                <dt>Status</dt>
                <dd><span className="badge warning task-recurring-pill">pending run</span></dd>
              </div>
            ) : null}
          </dl>

          <div className="task-schedule-actions">
            {isTimedTask ? (
              <button
                type="button"
                className="btn ghost compact"
                onClick={recurringSchedule.state === "active" ? props.onPauseSchedule : props.onResumeSchedule}
                disabled={props.isScheduleActionBusy}
              >
                {recurringSchedule.state === "active" ? "Stop timed run" : "Start timed run"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn ghost compact"
                  onClick={props.onPauseSchedule}
                  disabled={props.isScheduleActionBusy || recurringSchedule.state !== "active"}
                >
                  Pause
                </button>
                <button
                  type="button"
                  className="btn ghost compact"
                  onClick={props.onResumeSchedule}
                  disabled={props.isScheduleActionBusy || recurringSchedule.state === "active"}
                >
                  Resume
                </button>
                <button
                  type="button"
                  className="btn ghost compact"
                  onClick={props.onRunNowSchedule}
                  disabled={props.isScheduleActionBusy || recurringSchedule.state !== "active"}
                >
                  Run now
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Subtasks as a count chip that discloses the list, rather than a permanent row.
 */
function TaskDetailSubtasksChip(props: {
  subtasks: NonNullable<TaskDetail["subtasks"]>;
  onOpenSubtask: (subtaskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (props.subtasks.length === 0) {
    return null;
  }

  return (
    <div className={`task-subtasks-disclosure${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="task-subtasks-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <ChevronRight size={13} aria-hidden="true" className="task-subtasks-toggle-chevron" />
        <span>
          {props.subtasks.length} {props.subtasks.length === 1 ? "subtask" : "subtasks"}
        </span>
      </button>

      {expanded ? (
        <div className="task-subtasks-list">
          {props.subtasks.map((subtask) => (
            <button
              key={subtask.id}
              type="button"
              className="task-subtask-chip"
              onClick={() => props.onOpenSubtask(subtask.id)}
            >
              <span className="task-subtask-title">{subtask.title || "Untitled subtask"}</span>
              <span className={`${badgeClass(subtask.status)} task-subtask-status`}>{subtask.status}</span>
              <span className="muted-text task-subtask-updated">{formatRelative(subtask.updated_at)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TaskDetailTabBar(props: {
  activeTab: TaskDetailTab;
  onTabChange: (nextTab: TaskDetailTab) => void;
  newMessageOrganizationEnabled?: boolean;
  isConversationOutlineOpen?: boolean;
  onConversationOutlineToggle?: () => void;
  isMessageOutlineOpen: boolean;
  onMessageOutlineToggle: () => void;
  debugMode: boolean;
  persistentShellCount: number;
}) {
  return (
    <div className="tab-row task-tab-row" data-onboarding-id="task-detail-tabs">
      <div className="task-tab-row-main" role="tablist">
        <button
          role="tab"
          aria-selected={props.activeTab === "conversation"}
          className={`tab-btn ${props.activeTab === "conversation" ? "active" : ""}`}
          onClick={() => props.onTabChange("conversation")}
          title="Conversation"
        >
          <MessageSquare size={14} />
          <span className="task-tab-btn-label">Conversation</span>
        </button>
        <button
          role="tab"
          aria-selected={props.activeTab === "events"}
          className={`tab-btn ${props.activeTab === "events" ? "active" : ""}`}
          onClick={() => props.onTabChange("events")}
          title="Events"
        >
          <Activity size={14} />
          <span className="task-tab-btn-label">Events</span>
        </button>
        <button
          role="tab"
          aria-selected={props.activeTab === "artifacts"}
          className={`tab-btn ${props.activeTab === "artifacts" ? "active" : ""}`}
          onClick={() => props.onTabChange("artifacts")}
          title="Artifacts"
        >
          <Package size={14} />
          <span className="task-tab-btn-label">Artifacts</span>
        </button>
        <button
          role="tab"
          aria-selected={props.activeTab === "notifications"}
          className={`tab-btn ${props.activeTab === "notifications" ? "active" : ""}`}
          onClick={() => props.onTabChange("notifications")}
          title="Notifications"
        >
          <Bell size={14} />
          <span className="task-tab-btn-label">Notifications</span>
        </button>
        {props.persistentShellCount > 0 ? (
          <button
            role="tab"
            aria-selected={props.activeTab === "shells"}
            className={`tab-btn ${props.activeTab === "shells" ? "active" : ""}`}
            onClick={() => props.onTabChange("shells")}
            title={`(${props.persistentShellCount}) shells created`}
          >
            <Terminal size={14} />
            <span className="task-tab-btn-label">({props.persistentShellCount}) shells created</span>
          </button>
        ) : null}
        {props.debugMode === true ? (
          <button
            role="tab"
            aria-selected={props.activeTab === "debug"}
            className={`tab-btn debug-tab-btn ${props.activeTab === "debug" ? "active" : ""}`}
            onClick={() => props.onTabChange("debug")}
            title="DEBUG"
          >
            <Bug size={14} />
            <span className="task-tab-btn-label">DEBUG</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TaskDetailMobileNavButton(props: {
  isMobileViewport: boolean;
  onOpenMobileNavigation?: () => void;
}) {
  if (!props.isMobileViewport || !props.onOpenMobileNavigation) {
    return null;
  }

  return (
    <button
      type="button"
      className="task-topbar-mobile-nav-btn"
      onClick={props.onOpenMobileNavigation}
      aria-label="Open navigation"
      title="Open navigation"
    >
      <PanelLeftOpen size={16} />
    </button>
  );
}

export function TaskDetailTopbar(props: TaskDetailTopbarProps) {
  const recurringSchedule = props.task.schedule ?? null;
  const usage = getUsageSummary(props.latestContextUsage);
  const displayStatus = props.displayStatus ?? getDisplayStatus(props.task);
  const isCollapsed = props.isMobileViewport && props.topbarCollapsed;

  return (
    <div className={`topbar chat-task-topbar${isCollapsed ? " collapsed" : ""}${props.workflowStrip || props.workflowPanel ? " has-workflow-panel" : ""}`}>
      <div className="chat-task-topbar-collapsed-bar">
        <div className="chat-task-topbar-collapsed-bar-main">
          <TaskDetailMobileNavButton
            isMobileViewport={props.isMobileViewport}
            onOpenMobileNavigation={props.onOpenMobileNavigation}
          />
          <button
            type="button"
            className="chat-task-topbar-collapsed-expand"
            onClick={props.onExpandRequested}
            aria-expanded={!isCollapsed}
          >
            <span className="chat-task-topbar-collapsed-bar-title">{props.task.title || "Untitled Task"}</span>
            <span className="chat-task-topbar-collapsed-bar-meta">
              <TaskStatusBadge status={displayStatus} className="task-topbar-status task-topbar-status-compact" />
              <ChevronRight size={14} aria-hidden="true" className="chat-task-topbar-collapsed-bar-affordance" />
            </span>
          </button>
        </div>
      </div>
      <div className="chat-task-topbar-content">
        <div className="topbar-actions task-topbar-primary-row">
          <div className="task-topbar-summary">
            <div className="task-topbar-title-row">
              <TaskDetailMobileNavButton
                isMobileViewport={props.isMobileViewport}
                onOpenMobileNavigation={props.onOpenMobileNavigation}
              />
              <h3 className="task-topbar-title">{props.task.title || "Untitled Task"}</h3>
              <TaskStatusBadge status={displayStatus} className="task-topbar-status" />
              {props.task.task_type && props.task.task_type !== "standard" ? (
                <span className="badge muted task-recurring-pill">{formatTaskTypeLabel(props.task.task_type)}</span>
              ) : null}
              {recurringSchedule ? (
                <TaskDetailScheduleChip
                  task={props.task}
                  isScheduleActionBusy={props.isScheduleActionBusy}
                  onPauseSchedule={props.onPauseSchedule}
                  onResumeSchedule={props.onResumeSchedule}
                  onRunNowSchedule={props.onRunNowSchedule}
                />
              ) : null}
              <TaskDetailSubtasksChip subtasks={props.subtasks} onOpenSubtask={props.onOpenSubtask} />
              <TaskDetailUsageChip
                usage={usage}
                expanded={props.contextChipExpanded}
                onExpandedChange={props.onContextChipExpandedChange}
              />
              <SubscriptionUsageWarningLink warning={props.subscriptionUsageWarning ?? null} className="subscription-usage-warning-link task-topbar-usage-warning-link" />
            </div>
          </div>
          <div className="task-topbar-controls">
            {props.allTasksHref ? (
              <Link to={props.allTasksHref} className="btn ghost task-topbar-all-tasks">All tasks</Link>
            ) : null}
            <TaskDetailDisplaySettingsDropdown
              newMessageOrganizationEnabled={props.newMessageOrganizationEnabled}
              value={props.messageDisplayPreferences}
              onChange={props.onMessageDisplayPreferencesChange}
              disabled={props.isMessageDisplayPreferencesSaving}
              isSaving={props.isMessageDisplayPreferencesSaving}
            />
            {props.task.is_incognito === true && props.onDeletePermanently ? (
              <button
                type="button"
                className="task-topbar-icon-btn danger"
                onClick={props.onDeletePermanently}
                disabled={props.isDeletingPermanently === true || props.isTaskRunning}
                title={props.isTaskRunning ? "Cancel the task before deleting permanently" : "Delete permanently"}
                aria-label="Delete permanently"
              >
                <Trash2 size={16} />
              </button>
            ) : null}
            <TaskDetailActionsMenu
              actionsMenuRef={props.actionsMenuRef}
              actionsMenuOpen={props.actionsMenuOpen}
              onToggle={props.onActionsMenuToggle}
              onViewFiles={props.onViewFiles}
              onOpenTaskFolder={props.onOpenTaskFolder}
              canOpenTaskFolder={props.canOpenTaskFolder}
              onExportJson={props.onExportJson}
              onExportMarkdown={props.onExportMarkdown}
              isExportingChat={props.isExportingChat}
              onCompactContext={props.onCompactContext}
              onClearContext={props.onClearContext}
              isTaskRunning={props.isTaskRunning}
              isCompacting={props.isCompacting}
              isClearingContext={props.isClearingContext}
              onOpenSearch={props.onOpenSearch}
              newMessageOrganizationEnabled={props.newMessageOrganizationEnabled}
              isConversationOutlineOpen={props.isConversationOutlineOpen}
              onConversationOutlineToggle={props.onConversationOutlineToggle}
              isMessageOutlineOpen={props.isMessageOutlineOpen}
              onMessageOutlineToggle={props.onMessageOutlineToggle}
            />
          </div>
        </div>
        {props.workflowStrip ? (
          <div className="task-topbar-workflow-slot">{props.workflowStrip}</div>
        ) : props.workflowPanel ? (
          <div className="task-topbar-workflow-slot">{props.workflowPanel}</div>
        ) : null}
        <TaskDetailTabBar
          activeTab={props.activeTab}
          onTabChange={props.onTabChange}
          isMessageOutlineOpen={props.isMessageOutlineOpen}
          onMessageOutlineToggle={props.onMessageOutlineToggle}
          debugMode={props.debugMode === true}
          persistentShellCount={props.persistentShellCount ?? 0}
        />
      </div>
    </div>
  );
}
