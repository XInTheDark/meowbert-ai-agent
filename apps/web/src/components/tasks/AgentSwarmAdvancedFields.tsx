import {
  AGENT_SWARM_ADVANCED_FIELDS,
  type AgentSwarmAdvancedDraft,
  type AgentSwarmAdvancedNumberKey
} from "../../task/agentSwarmAdvancedFields";

interface AgentSwarmAdvancedFieldsProps {
  draft: AgentSwarmAdvancedDraft;
  budgetsEnabled: boolean;
  disabled?: boolean;
  onChange: (next: AgentSwarmAdvancedDraft) => void;
  // Called when a field is left or the switch is flipped, with the draft to apply.
  onCommit?: (next: AgentSwarmAdvancedDraft) => void;
}

// The swarm's lane limits, collapsed by default. Budget-only fields show while budgets are on.
export function AgentSwarmAdvancedFields(props: AgentSwarmAdvancedFieldsProps) {
  const setNumber = (key: AgentSwarmAdvancedNumberKey, value: string) => props.onChange({ ...props.draft, [key]: value });
  return (
    <details className="task-parameters-advanced">
      <summary>Advanced...</summary>
      <div className="task-parameters-advanced-content">
        <label className="task-parameters-toggle">
          <input type="checkbox" checked={props.draft.autoCheck} disabled={props.disabled}
            onChange={(event) => {
              const next = { ...props.draft, autoCheck: event.target.checked };
              props.onChange(next);
              props.onCommit?.(next);
            }} />
          <span><strong>Automatic Check</strong><small>A fresh reviewer checks replies on turns that used lanes.</small></span>
        </label>
        {AGENT_SWARM_ADVANCED_FIELDS.filter((field) => !field.budgetsOnly || props.budgetsEnabled).map((field) => (
          <label key={field.key} className="task-parameters-field">
            <span>{field.label}</span>
            <input type="number" step="1" value={props.draft[field.key]} disabled={props.disabled}
              placeholder={field.nullable ? "Task default" : undefined}
              onChange={(event) => setNumber(field.key, event.target.value)}
              onBlur={() => props.onCommit?.(props.draft)} />
          </label>
        ))}
      </div>
    </details>
  );
}
