import { ChevronRight, LoaderCircle } from "lucide-react";

export interface ToolActivitySummaryCardProps {
  kicker: string;
  title: string;
  count: number;
  preview?: string | null;
  secondaryLabel?: string | null;
  badgeTone?: "default" | "running";
  active?: boolean;
  onClick: () => void;
}

export function ToolActivitySummaryCard(props: ToolActivitySummaryCardProps): JSX.Element {
  const {
    kicker,
    title,
    count,
    preview,
    secondaryLabel,
    badgeTone = "default",
    active = false,
    onClick
  } = props;

  return (
    <button type="button" className={`tool-activity-card${active ? " active" : ""}`} onClick={onClick}>
      <div className="tool-activity-card-main">
        <div className="tool-activity-card-kicker-row">
          <span className="tool-activity-card-kicker">
            {badgeTone === "running" ? <LoaderCircle size={12} className="tool-activity-running-icon" /> : null}
            {kicker}
          </span>
          {preview ? <span className="tool-activity-card-preview">{preview}</span> : null}
        </div>
        <div className="tool-activity-card-title-row">
          <span className="tool-activity-card-title">{title}</span>
          <span className={`tool-count-badge${badgeTone === "running" ? " running" : ""}`}>
            {count} call{count !== 1 ? "s" : ""}
          </span>
          {secondaryLabel ? (
            <span className="tool-activity-card-secondary-pill">{secondaryLabel}</span>
          ) : null}
        </div>
      </div>
      <span className="tool-activity-card-chevron" aria-hidden="true">
        <ChevronRight size={16} />
      </span>
    </button>
  );
}
