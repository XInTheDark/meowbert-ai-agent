import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { computeCacheHitRate, type TaskUsageSummary } from "@meowbert/shared/token-usage-stats";
import { TokenUsageBreakdown } from "../../../components/usage/TokenUsageBreakdown";
import { UsageWeightingToggle } from "../../../components/usage/UsageWeightingToggle";
import type { TokenUsageWeighting } from "../../../components/usage/tokenUsageCategories";
import { formatCompactNumber, formatNumber, formatRatioPercent } from "../../../components/usage/tokenUsageFormat";
import { TaskUsageRunTable } from "./TaskUsageRunTable";
import { useTaskUsage } from "./useTaskUsage";

function TaskUsageStat(props: { label: string; value: string; title?: string }) {
  return (
    <div className="task-usage-stat" title={props.title}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function TaskUsageContent(props: { usage: TaskUsageSummary; weighting: TokenUsageWeighting }) {
  const { totals } = props.usage;
  if (totals.requestCount === 0) {
    return <p className="muted-text">No platform model usage has been recorded for this task.</p>;
  }

  return (
    <>
      <div className="task-usage-stats">
        <TaskUsageStat
          label="Weighted"
          value={formatCompactNumber(totals.weightedTokens)}
          title={formatNumber(totals.weightedTokens)}
        />
        <TaskUsageStat label="Cache hit" value={formatRatioPercent(computeCacheHitRate(totals))} />
        <TaskUsageStat label="Requests" value={formatNumber(totals.requestCount)} />
        <TaskUsageStat label="Runs" value={formatNumber(props.usage.runCount)} />
      </div>
      <TokenUsageBreakdown totals={totals} weighting={props.weighting} />
      <TaskUsageRunTable runs={props.usage.runs} runCount={props.usage.runCount} weighting={props.weighting} />
    </>
  );
}

export function TaskUsageModal(props: { taskId: string; onClose: () => void }) {
  const { usage, isLoading, error } = useTaskUsage(props.taskId);
  const [weighting, setWeighting] = useState<TokenUsageWeighting>("raw");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  return (
    <div className="legal-overlay" onClick={props.onClose}>
      <div
        className="legal-modal task-usage-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-usage-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="legal-modal-header">
          <h2 id="task-usage-modal-title">Task usage</h2>
          <div className="task-usage-modal__actions">
            <UsageWeightingToggle value={weighting} onChange={setWeighting} />
            <button className="legal-close" type="button" onClick={props.onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="legal-modal-body task-usage-modal__body">
          {error ? <p className="error-text">{error}</p> : null}
          {usage ? (
            <TaskUsageContent usage={usage} weighting={weighting} />
          ) : isLoading ? (
            <p className="muted-text">Loading usage...</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
