import type { AdminUsageStatisticsBreakdown } from "../shared";
import { formatMetricValue, metricScaleMax, valueForMetric, type MetricKey } from "./statisticsMetrics";

export type SelectionKind = "models" | "users";

export function StatisticsBreakdownChart(props: {
  title: string;
  rows: AdminUsageStatisticsBreakdown[];
  selectedIds: string[];
  metric: MetricKey;
  selectionKind: SelectionKind;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
}) {
  const maxValue = metricScaleMax(props.rows, props.metric);
  const visibleRows = props.rows.slice(0, 10);

  return (
    <article className="admin-stat-panel">
      <div className="admin-stat-panel__head">
        <div>
          <h4>{props.title}</h4>
          <p className="muted-text">
            {props.selectedIds.length > 0
              ? `${props.selectedIds.length} ${props.selectionKind} selected`
              : `Top ${props.selectionKind} in range`}
          </p>
        </div>
      </div>
      {props.onSearchChange ? (
        <input
          className="admin-breakdown-search"
          type="search"
          value={props.searchValue ?? ""}
          placeholder={props.searchPlaceholder ?? "Search"}
          onChange={(event) => props.onSearchChange?.(event.target.value)}
        />
      ) : null}

      <div className="admin-bar-chart">
        {visibleRows.length === 0 ? (
          <div className="admin-chart-empty">No usage in this range</div>
        ) : visibleRows.map((row) => {
          const value = valueForMetric(row, props.metric);
          return (
            <div key={row.id} className="admin-bar-row">
              <div className="admin-bar-row__label">
                <strong>{row.label}</strong>
                {row.detail && row.detail !== row.label ? <small>{row.detail}</small> : null}
              </div>
              <div className="admin-bar-row__track">
                <span style={{ width: `${Math.max(2, ((value ?? 0) / maxValue) * 100)}%` }} />
              </div>
              <div className="admin-bar-row__value">{formatMetricValue(value, props.metric)}</div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
