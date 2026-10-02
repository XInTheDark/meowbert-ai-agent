import { RefreshCw } from "lucide-react";
import type { AdminStatisticsBucket, AdminStatisticsRange } from "../shared";
import { METRIC_OPTIONS, type MetricKey } from "./statisticsMetrics";

const RANGE_OPTIONS: Array<{ key: AdminStatisticsRange; label: string }> = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "custom", label: "Custom" }
];

const BUCKET_OPTIONS: Array<{ key: "auto" | AdminStatisticsBucket; label: string }> = [
  { key: "auto", label: "Auto" },
  { key: "hour", label: "Hour" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" }
];

export function StatisticsToolbar(props: {
  range: AdminStatisticsRange;
  bucket: "auto" | AdminStatisticsBucket;
  from: string;
  to: string;
  metric: MetricKey;
  isLoading: boolean;
  onRangeChange: (value: AdminStatisticsRange) => void;
  onBucketChange: (value: "auto" | AdminStatisticsBucket) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onMetricChange: (value: MetricKey) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="admin-stat-toolbar">
      <div className="admin-segmented-control">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={props.range === option.key ? "active" : ""}
            onClick={() => props.onRangeChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {props.range === "custom" ? (
        <div className="admin-date-range">
          <input type="datetime-local" value={props.from} onChange={(event) => props.onFromChange(event.target.value)} />
          <input type="datetime-local" value={props.to} onChange={(event) => props.onToChange(event.target.value)} />
        </div>
      ) : null}
      <select value={props.bucket} onChange={(event) => props.onBucketChange(event.target.value as typeof props.bucket)}>
        {BUCKET_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <select value={props.metric} onChange={(event) => props.onMetricChange(event.target.value as MetricKey)}>
        {METRIC_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <button className="btn ghost" type="button" onClick={props.onRefresh} disabled={props.isLoading}>
        <RefreshCw size={16} />
        Refresh
      </button>
    </div>
  );
}
