import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { badgeClass } from "../../../lib/utils";

interface TaskWorkflowTextPanelProps {
  content: string | null | undefined;
  emptyLabel: string;
  badgeLabel?: string | null;
  badgeTone?: "succeeded" | "failed" | "muted";
}

export function TaskWorkflowTextPanel(props: TaskWorkflowTextPanelProps) {
  const [copied, setCopied] = useState(false);
  const normalized = typeof props.content === "string" ? props.content.trim() : "";

  const handleCopy = async () => {
    if (!normalized) return;
    try {
      await navigator.clipboard.writeText(normalized);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard errors
    }
  };

  return (
    <div className="workflow-text-sidebar-pane">
      <div className="workflow-text-toolbar">
        {props.badgeLabel ? (
          <span className={`${badgeClass(props.badgeTone ?? "muted")} task-recurring-pill`}>
            {props.badgeLabel}
          </span>
        ) : <div />}
        {normalized.length > 0 ? (
          <button
            type="button"
            className="btn ghost compact workflow-text-copy-btn"
            onClick={() => { void handleCopy(); }}
            title="Copy text"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        ) : null}
      </div>

      <div className="workflow-text-content-wrapper">
        {normalized.length > 0 ? (
          <pre className="workflow-text-preformatted">{normalized}</pre>
        ) : (
          <div className="muted-text" style={{ padding: "1rem", textAlign: "center" }}>
            {props.emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
