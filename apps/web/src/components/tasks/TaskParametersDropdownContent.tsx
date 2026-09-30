import {
  Brain,
  Check,
  ChevronLeft,
  Clock3,
  Crown,
  Minus,
  Plus,
  Repeat2,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Users
} from "lucide-react";
import {
  AGENT_SWARM_DEFAULT_WORKERS,
  AGENT_SWARM_MAX_REVIEW_ROUNDS,
  AGENT_SWARM_MAX_WORKERS,
  AGENT_SWARM_MIN_WORKERS
} from "@meowbert/shared/agent-swarm";
import {
  MAX_LONG_HORIZON_TOKEN_BUDGET,
  MAX_LONG_HORIZON_TIME_BUDGET_MINUTES,
  MAX_AGENT_SWARM_TIME_BUDGET_MINUTES,
  MAX_AGENT_SWARM_TOKEN_BUDGET,
  formatMinutes,
  type TaskParametersDropdownController
} from "./taskParametersDropdownController";
import { TaskTypeChangeConfirmModal } from "./TaskTypeChangeConfirmModal";
import { useChatToolsDropdownPlacement } from "./useChatToolsDropdownPlacement";

type ControllerProps = { controller: TaskParametersDropdownController };

function FormHeader({ controller, title }: ControllerProps & { title: string }) {
  return (
    <div className="task-parameters-header">
      <button
        type="button"
        className="task-parameters-back"
        onClick={() => {
          controller.draft.setPanel("menu");
          controller.setApplyError(null);
        }}
        disabled={controller.isApplying}
      >
        <ChevronLeft size={14} />
        Back
      </button>
      <span className="task-parameters-title">{title}</span>
    </div>
  );
}

function ParametersSummary({ controller }: ControllerProps) {
  if (controller.workflowSummary) {
    return (
      <div className="task-parameters-summary">
        <strong>{controller.workflowSummary}</strong>
        <span>{controller.props.workflowConfig?.type === "agent_swarm"
          ? "Leader + workers collaborate through shared channels."
          : "Clarify first, then execute against a durable plan."}</span>
      </div>
    );
  }
  if (!controller.scheduleSummary && controller.draft.resolved.allowWaiting !== false) return null;
  return (
    <div className="task-parameters-summary">
      <strong>{controller.scheduleSummary ?? "Custom parameters"}</strong>
      {controller.draft.resolved.schedule.deadlineAt ? (
        <span>Current run ends {new Date(controller.draft.resolved.schedule.deadlineAt).toLocaleString()}.</span>
      ) : null}
      {controller.draft.resolved.timeLimitSeconds ? (
        <span>Task cancels after {formatMinutes(controller.draft.resolved.timeLimitSeconds)} min.</span>
      ) : null}
      {controller.draft.resolved.allowWaiting === false ? <span>Waiting is disabled for this task.</span> : null}
    </div>
  );
}

function WorkflowMenu({ controller }: ControllerProps) {
  if (!controller.canEditWorkflow) return null;
  const config = controller.props.workflowConfig!;
  const isStandard = config.type === "standard" && controller.draft.resolved.schedule.type === "standard";
  return (
    <>
      <div className="chat-tools-section-label">Workflow</div>
      <button
        type="button"
        className={`chat-tools-item ${isStandard ? "active" : ""}`}
        onClick={() => controller.requestTaskTypeChange("standard", "Standard task", () => controller.workflow.applyWorkflow({
          type: "standard",
          workerCount: config.workerCount ?? AGENT_SWARM_DEFAULT_WORKERS,
          reviewRounds: 0,
          modelAllocations: [],
          tokenBudget: null
        }))}
        disabled={controller.isApplying}
      >
        <span className="chat-tools-item-label"><SlidersHorizontal size={14} />Standard task</span>
        {isStandard ? <Check size={14} /> : null}
      </button>
      <button
        type="button"
        className={`chat-tools-item ${config.type === "long_horizon" ? "active" : ""}`}
        onClick={() => controller.requestTaskTypeChange("long_horizon", "Long Horizon", () => {
          controller.draft.setPanel("longHorizon");
          controller.setApplyError(null);
        })}
        disabled={controller.isApplying}
      >
        <span className="chat-tools-item-label"><Brain size={14} />Long Horizon</span>
        {config.type === "long_horizon" ? <Check size={14} /> : null}
      </button>
      <button
        type="button"
        className={`chat-tools-item ${config.type === "deep_research" ? "active" : ""}`}
        onClick={() => controller.requestTaskTypeChange("deep_research", "Deep Research", () => {
          controller.draft.setPanel("deepResearch");
          controller.setApplyError(null);
        })}
        disabled={controller.isApplying}
      >
        <span className="chat-tools-item-label"><Search size={14} />Deep Research</span>
        {config.type === "deep_research" ? <Check size={14} /> : null}
      </button>
      <button
        type="button"
        className={`chat-tools-item ${config.type === "quality_control" ? "active" : ""}`}
        onClick={() => controller.requestTaskTypeChange("quality_control", "Quality control", () => {
          controller.draft.setPanel("qualityControl");
          controller.setApplyError(null);
        })}
        disabled={controller.isApplying}
      >
        <span className="chat-tools-item-label">
          <ShieldCheck size={14} />
          Quality control
          {" "}
          <small className="task-parameters-experimental-label">Experimental</small>
        </span>
        {config.type === "quality_control" ? <Check size={14} /> : null}
      </button>
      <button
        type="button"
        className={`chat-tools-item ${config.type === "agent_swarm" ? "active" : ""}`}
        onClick={() => controller.requestTaskTypeChange("agent_swarm", "Agent Swarm", () => {
          controller.draft.setPanel("agentSwarm");
          controller.setApplyError(null);
          controller.applySwarmUpdate({});
        })}
        disabled={controller.isApplying}
      >
        <span className="chat-tools-item-label"><Users size={14} />Agent Swarm</span>
        {config.type === "agent_swarm" ? <Check size={14} /> : null}
      </button>
      <div className="chat-tools-separator" />
    </>
  );
}

function ScheduleMenu({ controller }: ControllerProps) {
  if (!controller.showScheduleControls) return null;
  const scheduleType = controller.draft.resolved.schedule.type;
  const openPanel = (panel: "scheduled" | "timed", label: string) => {
    controller.requestTaskTypeChange(panel, label, () => {
      controller.draft.setPanel(panel);
      controller.setApplyError(null);
    });
  };
  return (
    <>
      <div className="chat-tools-section-label">Schedule</div>
      <button type="button" className={`chat-tools-item ${scheduleType === "scheduled" ? "active" : ""}`}
        onClick={() => openPanel("scheduled", "Scheduled task")} disabled={controller.isApplying}>
        <span className="chat-tools-item-label"><Clock3 size={14} />Scheduled task</span>
        {scheduleType === "scheduled" ? <Check size={14} /> : null}
      </button>
      <button type="button" className={`chat-tools-item ${scheduleType === "infinite" ? "active" : ""}`}
        onClick={() => controller.requestTaskTypeChange("infinite", "Infinite task", () => controller.schedule.applyInfiniteTask())} disabled={controller.isApplying}>
        <span className="chat-tools-item-label"><Repeat2 size={14} />Infinite task</span>
        {scheduleType === "infinite" ? <Check size={14} /> : null}
      </button>
      <button type="button" className={`chat-tools-item ${scheduleType === "timed" ? "active" : ""}`}
        onClick={() => openPanel("timed", "Timed task")} disabled={controller.isApplying}>
        <span className="chat-tools-item-label"><Timer size={14} />Timed task</span>
        {scheduleType === "timed" ? <Check size={14} /> : null}
      </button>
      {scheduleType !== "standard" ? (
        <button type="button" className="chat-tools-item"
          onClick={() => controller.requestTaskTypeChange("standard", "Standard task", () => controller.schedule.clearSchedule())} disabled={controller.isApplying}>
          <span className="chat-tools-item-label">Clear schedule</span>
        </button>
      ) : null}
      <div className="chat-tools-separator" />
    </>
  );
}

function ParametersMenu({ controller }: ControllerProps) {
  return (
    <>
      <div className="chat-tools-section-label">Parameters</div>
      <button
        type="button"
        className={`chat-tools-item ${controller.hasParameterOverrides ? "active" : ""}`}
        onClick={() => {
          controller.draft.setPanel("parameters");
          controller.setApplyError(null);
        }}
        disabled={controller.isApplying}
      >
        <span className="chat-tools-item-label"><SlidersHorizontal size={14} />Edit parameters</span>
        {controller.hasParameterOverrides ? <Check size={14} /> : null}
      </button>
    </>
  );
}

function TaskParametersMenu({ controller }: ControllerProps) {
  return (
    <>
      <ParametersSummary controller={controller} />
      <WorkflowMenu controller={controller} />
      <ScheduleMenu controller={controller} />
      <ParametersMenu controller={controller} />
    </>
  );
}

function ScheduledTaskForm({ controller }: ControllerProps) {
  return (
    <div className="task-parameters-form">
      <FormHeader controller={controller} title="Scheduled task" />
      <label className="task-parameters-field">
        <span>Cron</span>
        <input type="text" value={controller.draft.scheduledCron}
          onChange={(event) => controller.draft.setScheduledCron(event.target.value)}
          placeholder="*/5 * * * *" disabled={controller.isApplying} />
      </label>
      <label className="task-parameters-field">
        <span>Timezone</span>
        <input type="text" value={controller.draft.scheduledTimezone}
          onChange={(event) => controller.draft.setScheduledTimezone(event.target.value)}
          placeholder="UTC" disabled={controller.isApplying} />
      </label>
      <p className="task-parameters-help">Use a 5-field cron expression.</p>
      {controller.applyError ? <p className="error-text task-parameters-error">{controller.applyError}</p> : null}
      <div className="task-parameters-actions">
        <button type="button" className="btn ghost" onClick={() => void controller.schedule.clearSchedule()}
          disabled={controller.isApplying}>Clear</button>
        <button type="button" className="btn primary" onClick={() => void controller.schedule.saveScheduledTask()}
          disabled={controller.isApplying}>Save</button>
      </div>
    </div>
  );
}

function TimedTaskForm({ controller }: ControllerProps) {
  return (
    <div className="task-parameters-form">
      <FormHeader controller={controller} title="Timed task" />
      <label className="task-parameters-field">
        <span>Time limit (minutes)</span>
        <input type="number" min="1" step="1" value={controller.draft.timedMinutes}
          onChange={(event) => controller.draft.setTimedMinutes(event.target.value)}
          placeholder="30" disabled={controller.isApplying} />
      </label>
      <p className="task-parameters-help">
        {controller.props.mode === "edit"
          ? "Timed mode keeps this chat auto-looping until the limit, then pauses again."
          : "Timed tasks keep auto-looping until this limit, then stop."}
      </p>
      {controller.applyError ? <p className="error-text task-parameters-error">{controller.applyError}</p> : null}
      <div className="task-parameters-actions">
        <button type="button" className="btn ghost" onClick={() => void controller.schedule.clearSchedule()}
          disabled={controller.isApplying}>Clear</button>
        <button type="button" className="btn primary" onClick={() => void controller.schedule.saveTimedTask()}
          disabled={controller.isApplying}>Save</button>
      </div>
    </div>
  );
}

function GeneralParametersForm({ controller }: ControllerProps) {
  const clear = () => {
    controller.draft.setMaxSteps("");
    controller.draft.setTaskTimeLimitMinutes("");
    controller.draft.setAllowWaiting(true);
    void controller.schedule.clearParameters();
  };
  return (
    <div className="task-parameters-form">
      <FormHeader controller={controller} title="Edit parameters" />
      <label className="task-parameters-field">
        <span>Max steps</span>
        <input type="number" min="1" step="1" value={controller.draft.maxSteps}
          onChange={(event) => controller.draft.setMaxSteps(event.target.value)}
          placeholder="Use server default" disabled={controller.isApplying} />
      </label>
      <label className="task-parameters-field">
        <span>Task time limit (minutes)</span>
        <input type="number" min="1" step="1" value={controller.draft.taskTimeLimitMinutes}
          onChange={(event) => controller.draft.setTaskTimeLimitMinutes(event.target.value)}
          placeholder="No hard limit" disabled={controller.isApplying} />
      </label>
      <label className="task-parameters-toggle">
        <input type="checkbox" checked={controller.draft.allowWaiting}
          onChange={(event) => controller.draft.setAllowWaiting(event.target.checked)} disabled={controller.isApplying} />
        <span><strong>Allow waiting</strong><small>When off, infinite and timed tasks cannot call <code>wait</code> and must keep working.</small></span>
      </label>
      <p className="task-parameters-help">
        Hard-cancels the task if it is still unfinished after this much time from the latest sent user message.
      </p>
      {controller.applyError ? <p className="error-text task-parameters-error">{controller.applyError}</p> : null}
      <div className="task-parameters-actions">
        <button type="button" className="btn ghost" onClick={clear} disabled={controller.isApplying}>Clear</button>
        <button type="button" className="btn primary" onClick={() => void controller.schedule.saveParameters()}
          disabled={controller.isApplying}>Save</button>
      </div>
    </div>
  );
}

function LongHorizonForm({
  controller,
  variant = "long_horizon"
}: ControllerProps & { variant?: "long_horizon" | "deep_research" | "quality_control" }) {
  const title = variant === "deep_research"
    ? "Deep Research"
    : variant === "quality_control" ? "Quality control" : "Long Horizon";
  const help = variant === "deep_research"
    ? "Uses the Long Horizon path for thorough, source-aware research. Budgets are steering guidance."
    : variant === "quality_control"
      ? "Uses the Long Horizon review path with a presentation and design audit. Budgets are steering guidance."
      : "Long Horizon treats budgets as steering, not hard stops.";
  return (
    <div className="task-parameters-form">
      <FormHeader controller={controller} title={title} />
      <label className="task-parameters-field">
        <span>Token budget</span>
        <input type="number" min="1" max={MAX_LONG_HORIZON_TOKEN_BUDGET} step="1000"
          value={controller.draft.longHorizonTokenBudget}
          onChange={(event) => controller.draft.setLongHorizonTokenBudget(event.target.value)}
          placeholder="No budget" disabled={controller.isApplying} />
      </label>
      <label className="task-parameters-field">
        <span>Time budget (minutes)</span>
        <input type="number" min="1" max={MAX_LONG_HORIZON_TIME_BUDGET_MINUTES} step="1"
          value={controller.draft.longHorizonTimeBudgetMinutes}
          onChange={(event) => controller.draft.setLongHorizonTimeBudgetMinutes(event.target.value)}
          placeholder="No budget" disabled={controller.isApplying} />
      </label>
      <p className="task-parameters-help">{help}</p>
      <details className="task-parameters-advanced">
        <summary>Advanced options</summary>
        <div className="task-parameters-advanced-content">
          <label className="task-parameters-toggle">
            <input type="checkbox" checked={controller.draft.longHorizonEnableClarifyPhase}
              onChange={(event) => controller.draft.setLongHorizonEnableClarifyPhase(event.target.checked)}
              disabled={controller.isApplying} />
            <span><strong>Clarify phase</strong><small>Clarifies requirements and writes a durable PLAN.md before starting work.</small></span>
          </label>
          <label className="task-parameters-toggle">
            <input type="checkbox" checked={controller.draft.longHorizonEnableReviewPhase}
              onChange={(event) => controller.draft.setLongHorizonEnableReviewPhase(event.target.checked)}
              disabled={controller.isApplying} />
            <span><strong>Review phase</strong><small>Audits work against the plan with an independent reviewer before final delivery.</small></span>
          </label>
        </div>
      </details>
      {controller.applyError ? <p className="error-text task-parameters-error">{controller.applyError}</p> : null}
      <div className="task-parameters-actions">
        <button type="button" className="btn ghost" onClick={() => {
          controller.draft.setLongHorizonTokenBudget("");
          controller.draft.setLongHorizonTimeBudgetMinutes("");
          controller.draft.setLongHorizonEnableClarifyPhase(true);
          controller.draft.setLongHorizonEnableReviewPhase(true);
          void controller.workflow.clearWorkflow();
        }} disabled={controller.isApplying}>Clear</button>
        <button type="button" className="btn primary" onClick={() => void (
          variant === "deep_research"
            ? controller.workflow.saveDeepResearch()
            : variant === "quality_control" ? controller.workflow.saveQualityControl() : controller.workflow.saveLongHorizon()
        )}
          disabled={controller.isApplying}>Save</button>
      </div>
    </div>
  );
}

function SwarmAgentAllocations({ controller }: ControllerProps) {
  if (!controller.agentSwarmHasAgentAllocations) {
    return (
      <label className="task-parameters-field">
        <span>Worker count</span>
        <input type="number" min={AGENT_SWARM_MIN_WORKERS} max={AGENT_SWARM_MAX_WORKERS} step="1"
          value={controller.draft.agentSwarmWorkerCount}
          onChange={(event) => controller.draft.setAgentSwarmWorkerCount(event.target.value)}
          placeholder={String(AGENT_SWARM_DEFAULT_WORKERS)} disabled={controller.isApplying} />
      </label>
    );
  }
  return (
    <div className="agent-swarm-agent-list">
      <div className="agent-swarm-agent-list-header">
        <span>Agents</span><strong>{controller.agentSwarmAllocatedWorkers} workers</strong>
      </div>
      {controller.draft.agents.map((agent) => {
        const count = controller.draft.agentSwarmAllocations.find((item) => item.agentId === agent.id)?.workerCount ?? 0;
        const isLeader = controller.draft.agentSwarmLeaderAgentId === agent.id;
        const roleLabel = agent.mode === "agent_swarm"
          ? "Agent Swarm"
          : agent.mode === "quality_control_reviewer" ? "Quality review" : null;
        return (
          <div key={agent.id} className="agent-swarm-agent-row">
            <div className="agent-swarm-agent-copy">
              <strong>{agent.name}</strong><span>{roleLabel ? `${roleLabel} · ` : ""}{count} {count === 1 ? "worker" : "workers"}</span>
            </div>
            <div className="agent-swarm-agent-controls">
              <button type="button" className={`icon-btn-subtle ${isLeader ? "active" : ""}`}
                onClick={() => {
                  controller.draft.setAgentSwarmLeaderAgentId(agent.id);
                  controller.applySwarmUpdate({ leaderAgentId: agent.id });
                }}
                disabled={controller.isApplying}
                title={`Make ${agent.name} the swarm leader`}
                aria-label={`Make ${agent.name} the swarm leader`}><Crown size={14} /></button>
              <button type="button" className="icon-btn-subtle" onClick={() => controller.adjustSwarmAllocation(agent.id, -1)}
                disabled={controller.isApplying || controller.agentSwarmAllocatedWorkers <= AGENT_SWARM_MIN_WORKERS || count <= 0}
                title={`Remove worker from ${agent.name}`}><Minus size={14} /></button>
              <button type="button" className="icon-btn-subtle" onClick={() => controller.adjustSwarmAllocation(agent.id, 1)}
                disabled={controller.isApplying || controller.agentSwarmAllocatedWorkers >= AGENT_SWARM_MAX_WORKERS}
                title={`Add worker to ${agent.name}`}><Plus size={14} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SwarmBudgetFields({ controller }: ControllerProps) {
  const budgetsDisabled = controller.draft.agentSwarmDisableSpawningAndBudgets;
  const budgetIsImmutable = controller.props.mode === "edit"
    && controller.props.workflowConfig?.type === "agent_swarm"
    && typeof controller.props.workflowConfig.tokenBudget === "number"
    && controller.props.workflowConfig.tokenBudget > 0;
  return (
    <>
      <label className="task-parameters-toggle">
        <input type="checkbox" checked={budgetsDisabled}
          onChange={(event) => {
            const disableSpawningAndBudgets = event.target.checked;
            controller.draft.setAgentSwarmDisableSpawningAndBudgets(disableSpawningAndBudgets);
            controller.applySwarmUpdate({ disableSpawningAndBudgets });
          }}
          disabled={controller.isApplying || budgetIsImmutable} />
        <span><strong>Disable spawning and budgets</strong><small>Runs with the configured roster only, with no token or time budget.</small></span>
      </label>
      {budgetsDisabled ? null : (
        <>
          <label className="task-parameters-field">
            <span>Token budget</span>
            <input type="number" min="1" max={MAX_AGENT_SWARM_TOKEN_BUDGET} step="1000"
              value={controller.draft.agentSwarmTokenBudget}
              onChange={(event) => controller.draft.setAgentSwarmTokenBudget(event.target.value)}
              placeholder="50000000" disabled={controller.isApplying} />
          </label>
          <label className="task-parameters-field">
            <span>Time budget (minutes)</span>
            <input type="number" min="1" max={MAX_AGENT_SWARM_TIME_BUDGET_MINUTES} step="1"
              value={controller.draft.agentSwarmTimeBudgetMinutes}
              onChange={(event) => controller.draft.setAgentSwarmTimeBudgetMinutes(event.target.value)}
              placeholder="No deadline" disabled={controller.isApplying} />
          </label>
          <p className="task-parameters-help">Swarm budgets limit weighted tokens and time. At least ten percent is held for recovery and final synthesis.</p>
        </>
      )}
    </>
  );
}

function AgentSwarmForm({ controller }: ControllerProps) {
  return (
    <div className="task-parameters-form">
      <FormHeader controller={controller} title="Agent Swarm" />
      <SwarmAgentAllocations controller={controller} />
      <SwarmBudgetFields controller={controller} />
      <p className="task-parameters-help">
        Choose the leader with the crown. Worker agents are bounded from {AGENT_SWARM_MIN_WORKERS} to {AGENT_SWARM_MAX_WORKERS}.
      </p>
      <label className="task-parameters-field">
        <span>Review rounds: {controller.draft.agentSwarmReviewRounds}</span>
        <input type="range" min="0" max={AGENT_SWARM_MAX_REVIEW_ROUNDS} step="1"
          value={controller.draft.agentSwarmReviewRounds}
          onChange={(event) => {
            const reviewRounds = Number(event.target.value);
            controller.draft.setAgentSwarmReviewRounds(reviewRounds);
            controller.applySwarmUpdate({ reviewRounds });
          }}
          disabled={controller.isApplying} />
      </label>
      <p className="task-parameters-help">
        Each round requires an independent worker critique before the leader can deliver the final result.
      </p>
      {controller.applyError ? <p className="error-text task-parameters-error">{controller.applyError}</p> : null}
      <div className="task-parameters-actions">
        <button type="button" className="btn ghost" onClick={() => {
          controller.draft.setAgentSwarmTokenBudget("");
          controller.draft.setAgentSwarmTimeBudgetMinutes("");
          void controller.workflow.clearWorkflow();
        }}
          disabled={controller.isApplying}>Clear</button>
      </div>
    </div>
  );
}

function ActivePanel({ controller }: ControllerProps) {
  switch (controller.draft.panel) {
    case "scheduled": return <ScheduledTaskForm controller={controller} />;
    case "timed": return <TimedTaskForm controller={controller} />;
    case "parameters": return <GeneralParametersForm controller={controller} />;
    case "longHorizon": return <LongHorizonForm controller={controller} />;
    case "deepResearch": return <LongHorizonForm controller={controller} variant="deep_research" />;
    case "qualityControl": return <LongHorizonForm controller={controller} variant="quality_control" />;
    case "agentSwarm": return <AgentSwarmForm controller={controller} />;
    default: return <TaskParametersMenu controller={controller} />;
  }
}

export function TaskParametersDropdownContent({ controller }: ControllerProps) {
  const { popoverRef, popoverStyle, popoverClassName } = useChatToolsDropdownPlacement({
    triggerRef: controller.menuRef,
    isOpen: controller.isOpen,
    placement: controller.props.popoverPlacement
  });

  return (
    <div ref={controller.menuRef} className="chat-tools-menu">
      <button
        type="button"
        className={`icon-btn-subtle ${controller.hasCustomParameters ? "active" : ""}`}
        onClick={() => controller.setIsOpen((current) => !current)}
        title="Task parameters"
        disabled={(controller.props.disabled ?? false) || controller.isApplying}
        aria-haspopup="menu"
        aria-expanded={controller.isOpen}
      >
        <SlidersHorizontal size={18} />
      </button>
      {controller.isOpen ? (
        <div
          ref={popoverRef}
          className={`chat-tools-popover ${popoverClassName}`}
          role="menu"
          aria-label="Task parameters"
          style={popoverStyle}
        >
          <div className="chat-tools-popover-scroll"><ActivePanel controller={controller} /></div>
        </div>
      ) : null}
      {controller.pendingTypeChange ? (
        <TaskTypeChangeConfirmModal
          targetTypeLabel={controller.pendingTypeChange.targetTypeLabel}
          isApplying={controller.isApplying}
          onCancel={controller.cancelTypeChange}
          onConfirm={controller.confirmTypeChange}
        />
      ) : null}
    </div>
  );
}
