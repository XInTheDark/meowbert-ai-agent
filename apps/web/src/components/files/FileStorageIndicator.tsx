import { Loader2 } from "lucide-react";
import type { StorageSummary } from "../../lib/types";
import { formatBytes } from "../../lib/utils";
import type { FileStorageMetrics } from "./fileStorageMetrics";
import type { FileStorageStatus } from "./useFileStorage";

interface FileStorageIndicatorProps {
  summary: StorageSummary | null;
  status: FileStorageStatus;
  metrics: FileStorageMetrics;
  isExpanded: boolean;
  onRequest: () => void;
  onExpandedChange: (expanded: boolean) => void;
}

// Storage usage is loaded on demand: "?%" until asked, then a percentage that expands to details.
export function FileStorageIndicator(props: FileStorageIndicatorProps) {
  const warning = props.summary?.isOverLimit === true;
  const { metrics } = props;
  if (props.status === "loading") {
    return <span className="context-usage-pill project-storage-loading" title="Checking storage..." aria-label="Checking storage"><Loader2 className="spin" size={14} /></span>;
  }
  if (props.status !== "ready") {
    const label = props.status === "error" ? "Retry storage summary" : "Load storage summary";
    return <button className={`context-usage-pill ${props.status === "error" ? "warning" : ""}`} type="button" onClick={props.onRequest} title={label} aria-label={label}>?%</button>;
  }
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
