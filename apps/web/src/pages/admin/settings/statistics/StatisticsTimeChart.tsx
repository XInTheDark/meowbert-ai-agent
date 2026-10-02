import { useState, type PointerEvent } from "react";
import { computeCacheHitRate } from "@meowbert/shared/token-usage-stats";
import { formatNumber, formatRatioPercent } from "../../../../components/usage/tokenUsageFormat";
import type { AdminStatisticsBucket, AdminUsageStatisticsPoint } from "../shared";
import { formatMetricValue, labelForMetric, metricScaleMax, valueForMetric, type MetricKey } from "./statisticsMetrics";

const CHART_WIDTH = 640;
const CHART_HEIGHT = 180;

export function formatBucketLabel(value: string, bucket: AdminStatisticsBucket): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (bucket === "hour") {
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  }
  if (bucket === "month") {
    return date.toLocaleString(undefined, { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function chartPoint(rows: AdminUsageStatisticsPoint[], rowIndex: number, metric: MetricKey, maxValue: number) {
  const value = valueForMetric(rows[rowIndex], metric);
  const x = rows.length === 1 ? CHART_WIDTH / 2 : (rowIndex / (rows.length - 1)) * CHART_WIDTH;
  const y = value === null ? null : CHART_HEIGHT - (value / maxValue) * CHART_HEIGHT;
  return { x, y };
}

function buildChartPath(rows: AdminUsageStatisticsPoint[], metric: MetricKey): string {
  const maxValue = metricScaleMax(rows, metric);
  let penDown = false;
  const segments: string[] = [];
  rows.forEach((_, index) => {
    const { x, y } = chartPoint(rows, index, metric, maxValue);
    if (y === null) {
      penDown = false;
      return;
    }
    segments.push(`${penDown ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`);
    penDown = true;
  });
  return segments.join(" ");
}

function ChartTooltip(props: {
  row: AdminUsageStatisticsPoint;
  bucket: AdminStatisticsBucket;
  metric: MetricKey;
  xPercent: number;
  yPercent: number;
}) {
  const placeBelow = props.yPercent < 28;
  return (
    <div
      className="admin-chart-tooltip"
      style={{
        left: `${Math.min(86, Math.max(14, props.xPercent))}%`,
        top: placeBelow
          ? `${Math.min(72, Math.max(2, props.yPercent))}%`
          : `${Math.min(78, Math.max(18, props.yPercent))}%`,
        transform: placeBelow ? "translate(-50%, 0.75rem)" : "translate(-50%, -110%)"
      }}
    >
      <strong>{formatBucketLabel(props.row.bucketStart, props.bucket)}</strong>
      <span>
        {labelForMetric(props.metric)}: {formatMetricValue(valueForMetric(props.row, props.metric), props.metric, false)}
      </span>
      <small>
        {formatNumber(props.row.inputTokens)} in · {formatNumber(props.row.cachedInputTokens)} cached · {formatNumber(props.row.outputTokens)} out
      </small>
      <small>
        {formatNumber(props.row.weightedTokens)} weighted · {formatRatioPercent(computeCacheHitRate(props.row))} cache hit · {formatNumber(props.row.requestCount)} req
      </small>
    </div>
  );
}

export function StatisticsTimeChart(props: {
  rows: AdminUsageStatisticsPoint[];
  bucket: AdminStatisticsBucket;
  metric: MetricKey;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const path = buildChartPath(props.rows, props.metric);
  const maxValue = metricScaleMax(props.rows, props.metric);
  const peakValue = props.rows.reduce<number | null>((peak, row) => {
    const value = valueForMetric(row, props.metric);
    return value === null ? peak : Math.max(peak ?? 0, value);
  }, null);
  const first = props.rows[0];
  const last = props.rows[props.rows.length - 1];
  const hoveredRow = hoveredIndex !== null ? props.rows[hoveredIndex] : undefined;
  const hoveredPoint = hoveredIndex !== null && hoveredRow
    ? chartPoint(props.rows, hoveredIndex, props.metric, maxValue)
    : null;
  const hoveredYPercent = hoveredPoint ? ((hoveredPoint.y ?? CHART_HEIGHT) / CHART_HEIGHT) * 100 : 100;

  function handleChartPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (props.rows.length === 0) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoveredIndex(Math.round(ratio * (props.rows.length - 1)));
  }

  return (
    <article className="admin-stat-panel admin-stat-panel--wide">
      <div className="admin-stat-panel__head">
        <div>
          <h4>Usage over time</h4>
          <p className="muted-text">Bucketed totals from model response usage events.</p>
        </div>
        <strong>{formatMetricValue(peakValue, props.metric)} peak</strong>
      </div>

      <div
        className="admin-line-chart"
        role="img"
        aria-label={`${labelForMetric(props.metric)} over time`}
        onPointerMove={handleChartPointerMove}
        onPointerLeave={() => setHoveredIndex(null)}
      >
        {path ? (
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none">
            <path d={path} />
          </svg>
        ) : (
          <div className="admin-chart-empty">No usage in this range</div>
        )}
        {hoveredRow && hoveredPoint ? (
          <>
            <span className="admin-chart-hover-line" style={{ left: `${(hoveredPoint.x / CHART_WIDTH) * 100}%` }} />
            {hoveredPoint.y !== null ? (
              <span
                className="admin-chart-hover-dot"
                style={{ left: `${(hoveredPoint.x / CHART_WIDTH) * 100}%`, top: `${hoveredYPercent}%` }}
              />
            ) : null}
            <ChartTooltip
              row={hoveredRow}
              bucket={props.bucket}
              metric={props.metric}
              xPercent={(hoveredPoint.x / CHART_WIDTH) * 100}
              yPercent={hoveredYPercent}
            />
          </>
        ) : null}
      </div>
      <div className="admin-chart-axis">
        <span>{first ? formatBucketLabel(first.bucketStart, props.bucket) : "-"}</span>
        <span>{last ? formatBucketLabel(last.bucketStart, props.bucket) : "-"}</span>
      </div>
    </article>
  );
}
