import type { ReactNode } from "react";
import { AGENT_SWARM_DEFAULT_TOKEN_BUDGET } from "@meowbert/shared/agent-swarm-config";
import { AgentSwarmAdvancedFields } from "./AgentSwarmAdvancedFields";
import {
  MAX_AGENT_SWARM_TIME_BUDGET_MINUTES,
  MAX_AGENT_SWARM_TOKEN_BUDGET,
  type TaskParametersDropdownController
} from "./taskParametersDropdownController";

type ControllerProps = { controller: TaskParametersDropdownController };

// Shown only when the platform has routers; without one every lane runs on the root model.
function SwarmRouterField({ controller }: ControllerProps) {
  const options = controller.swarmRouterOptions;
  if (options.length === 0) return null;
  const routerId = controller.props.workflowConfig?.routerId ?? "";
  return (
    <label className="task-parameters-field">
      <span>Lane model router</span>
      <select value={options.includes(routerId) ? routerId : ""} disabled={controller.isApplying}
        onChange={(event) => controller.applySwarmUpdate({ routerId: event.target.value || null })}>
        <option value="">None: lanes use the leader's model</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function SwarmBudgetFields({ controller }: ControllerProps) {
  const budgetsEnabled = controller.draft.agentSwarmBudgetsEnabled;
  return (
    <>
      <label className="task-parameters-toggle">
        <input type="checkbox" checked={budgetsEnabled}
          onChange={(event) => {
            const nextBudgetsEnabled = event.target.checked;
            controller.draft.setAgentSwarmBudgetsEnabled(nextBudgetsEnabled);
            controller.applySwarmUpdate({ budgetsEnabled: nextBudgetsEnabled });
          }}
          disabled={controller.isApplying} />
        <span><strong>Budgets</strong><small>Share one token and time budget across the leader and its lanes.</small></span>
      </label>
      {budgetsEnabled ? (
        <>
          <label className="task-parameters-field">
            <span>Token budget</span>
            <input type="number" min="1" max={MAX_AGENT_SWARM_TOKEN_BUDGET} step="1000"
              value={controller.draft.agentSwarmTokenBudget}
              onChange={(event) => controller.draft.setAgentSwarmTokenBudget(event.target.value)}
              onBlur={() => controller.applySwarmBudget("tokenBudget", controller.draft.agentSwarmTokenBudget)}
              placeholder={String(AGENT_SWARM_DEFAULT_TOKEN_BUDGET)} disabled={controller.isApplying} />
          </label>
          <label className="task-parameters-field">
            <span>Time budget (minutes)</span>
            <input type="number" min="1" max={MAX_AGENT_SWARM_TIME_BUDGET_MINUTES} step="1"
              value={controller.draft.agentSwarmTimeBudgetMinutes}
              onChange={(event) => controller.draft.setAgentSwarmTimeBudgetMinutes(event.target.value)}
              onBlur={() => controller.applySwarmBudget("timeBudgetMinutes", controller.draft.agentSwarmTimeBudgetMinutes)}
              placeholder="No deadline" disabled={controller.isApplying} />
          </label>
        </>
      ) : null}
    </>
  );
}

export function AgentSwarmParametersForm({ controller, header }: ControllerProps & { header: ReactNode }) {
  return (
    <div className="task-parameters-form">
      {header}
      <SwarmRouterField controller={controller} />
      <SwarmBudgetFields controller={controller} />
      <AgentSwarmAdvancedFields
        draft={controller.draft.agentSwarmAdvanced}
        budgetsEnabled={controller.draft.agentSwarmBudgetsEnabled}
        disabled={controller.isApplying}
        onChange={controller.draft.setAgentSwarmAdvanced}
        onCommit={controller.applySwarmAdvanced}
      />
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
