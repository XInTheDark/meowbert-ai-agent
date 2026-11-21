import type { ReactNode } from "react";
import { History, Lock } from "lucide-react";

interface ThreadComposerOptionRowProps {
  icon: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

function ThreadComposerOptionRow(props: ThreadComposerOptionRowProps) {
  return (
    <label className={`thread-composer-option${props.disabled ? " is-disabled" : ""}`}>
      <span className="thread-composer-option-main">
        <span className="thread-composer-option-icon" aria-hidden="true">
          {props.icon}
        </span>
        <span className="thread-composer-option-copy">
          <strong>{props.label}</strong>
          <small>{props.description}</small>
        </span>
      </span>
      <span className={`thread-composer-switch${props.checked ? " is-checked" : ""}`}>
        <input
          type="checkbox"
          role="switch"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.target.checked)}
        />
        <span className="thread-composer-switch-thumb" aria-hidden="true" />
      </span>
    </label>
  );
}

export function ThreadComposerOptions(props: {
  readOnly: boolean;
  readOnlyDisabledReason: string | null;
  includeFullHistory: boolean;
  disabled: boolean;
  onReadOnlyChange: (checked: boolean) => void;
  onIncludeFullHistoryChange: (checked: boolean) => void;
}) {
  const effectiveReadOnly = props.readOnlyDisabledReason ? false : props.readOnly;

  return (
    <div className="thread-composer-options" role="group" aria-label="Thread options">
      <ThreadComposerOptionRow
        icon={<Lock size={14} />}
        label="Read-only"
        description={props.readOnlyDisabledReason ?? "Read project files without changing them"}
        checked={effectiveReadOnly}
        disabled={props.disabled || props.readOnlyDisabledReason !== null}
        onChange={props.onReadOnlyChange}
      />
      <ThreadComposerOptionRow
        icon={<History size={14} />}
        label="Include full task history"
        description="Include tool calls and results, not just messages"
        checked={props.includeFullHistory}
        disabled={props.disabled}
        onChange={props.onIncludeFullHistoryChange}
      />
    </div>
  );
}
