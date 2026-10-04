import type { StorageSummary } from "../../lib/types";
import { formatBytes } from "../../lib/utils";
import type { FileStorageMetrics } from "./fileStorageMetrics";

interface FileStorageIndicatorProps {
  summary: StorageSummary | null;
  metrics: FileStorageMetrics;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

// A percentage that expands to details. Hidden when the server has no usage to report.
export function FileStorageIndicator(props: FileStorageIndicatorProps) {
  if (!props.summary) {
    return null;
  }
  const warning = props.summary.isOverLimit;
  const { metrics } = props;
  if (!metrics.hasLimit || metrics.usagePercent === null) {
    return <span className={`muted-text project-storage-label${warning ? " warning" : ""}`} title={metrics.label}>{metrics.label}</span>;
  }
  const tone = metrics.usagePercent >= 80 || warning ? "warning" : "";
  if (!props.isExpanded) {
    return <button className={`context-usage-pill ${tone}`} type="button" onClick={() => props.onExpandedChange(true)} title={metrics.tooltip}>{metrics.usagePercent}%</button>;
  }
  return (
    <div className={`context-usage-chip project-storage-expanded ${tone}`} onClick={() => props.onExpandedChange(false)} title="Click to collapse">
      <div className="context-usage-label">Storage {formatBytes(metrics.usedBytes)} / {formatBytes(metrics.limitBytes)} ({metrics.usagePercent}%)</div>
      {metrics.remainingBytes !== null ? <div className={`muted-text project-storage-remaining${warning ? " warning" : ""}`}>{metrics.remainingBytes >= 0 ? `${formatBytes(metrics.remainingBytes)} free` : `${formatBytes(Math.abs(metrics.remainingBytes))} over limit`}</div> : null}
      <div className="context-usage-meter"><span className={warning ? "warning" : ""} style={{ width: `${metrics.meterPercent}%` }} /></div>
    </div>
  );
}
