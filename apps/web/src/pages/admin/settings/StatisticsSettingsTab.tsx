import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import type {
  AdminStatisticsBucket,
  AdminStatisticsRange,
  AdminUsageStatistics,
  AdminUsageStatisticsBreakdown,
  AdminUsageStatisticsFilterOption,
  AdminUsageStatisticsPoint,
  AdminUsageStatisticsResponse
} from "./shared";

type MetricKey = "totalTokens" | "weightedTokens" | "requestCount";
type SelectionKind = "models" | "users";
const CHART_WIDTH = 640;
const CHART_HEIGHT = 180;

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

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

function formatDateForInput(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIsoQueryDate(value: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatBucketLabel(value: string, bucket: AdminStatisticsBucket): string {
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

function formatRangeLabel(usage: AdminUsageStatistics): string {
  const from = new Date(usage.range.from);
  const to = new Date(usage.range.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return `${usage.range.from} to ${usage.range.to}`;
  }
  return `${from.toLocaleDateString()} to ${to.toLocaleDateString()} - ${usage.range.bucket} buckets`;
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}

function valueForMetric(row: AdminUsageStatisticsPoint | AdminUsageStatisticsBreakdown, metric: MetricKey): number {
  return row[metric];
}

function labelForMetric(metric: MetricKey): string {
  if (metric === "weightedTokens") {
    return "Weighted tokens";
  }
  if (metric === "requestCount") {
    return "Requests";
  }
  return "Tokens";
}

function buildChartPoints(rows: AdminUsageStatisticsPoint[], metric: MetricKey): string {
  if (rows.length === 0) {
    return "";
  }

  const maxValue = Math.max(...rows.map((row) => valueForMetric(row, metric)), 1);
  return rows
    .map((row, index) => {
      const x = rows.length === 1 ? CHART_WIDTH / 2 : (index / (rows.length - 1)) * CHART_WIDTH;
      const y = CHART_HEIGHT - (valueForMetric(row, metric) / maxValue) * CHART_HEIGHT;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function chartPointPosition(rows: AdminUsageStatisticsPoint[], rowIndex: number, metric: MetricKey) {
  const maxValue = Math.max(...rows.map((row) => valueForMetric(row, metric)), 1);
  const x = rows.length === 1 ? CHART_WIDTH / 2 : (rowIndex / (rows.length - 1)) * CHART_WIDTH;
  const y = CHART_HEIGHT - (valueForMetric(rows[rowIndex], metric) / maxValue) * CHART_HEIGHT;
  return {
    xPercent: (x / CHART_WIDTH) * 100,
    yPercent: (y / CHART_HEIGHT) * 100
  };
}

function MetricCard(props: { label: string; value: number; detail: string }) {
  return (
    <article className="admin-stat-card">
      <span>{props.label}</span>
      <strong>{formatCompactNumber(props.value)}</strong>
      <small>{props.detail}</small>
    </article>
  );
}

function TimeUsageChart(props: {
  rows: AdminUsageStatisticsPoint[];
  bucket: AdminStatisticsBucket;
  metric: MetricKey;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const path = buildChartPoints(props.rows, props.metric);
  const maxValue = Math.max(...props.rows.map((row) => valueForMetric(row, props.metric)), 0);
  const first = props.rows[0];
  const last = props.rows[props.rows.length - 1];
  const hoveredPoint =
    hoveredIndex !== null && props.rows[hoveredIndex]
      ? {
          row: props.rows[hoveredIndex],
          position: chartPointPosition(props.rows, hoveredIndex, props.metric)
        }
      : null;
  const shouldPlaceTooltipBelow = (hoveredPoint?.position.yPercent ?? 100) < 28;

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
        <strong>{formatCompactNumber(maxValue)} peak</strong>
      </div>

      <div
        className="admin-line-chart"
        role="img"
        aria-label="Token usage over time"
        onPointerMove={handleChartPointerMove}
        onPointerLeave={() => setHoveredIndex(null)}
      >
        {path ? (
          <svg viewBox="0 0 640 180" preserveAspectRatio="none">
            <path d={path} />
          </svg>
        ) : (
          <div className="admin-chart-empty">No usage in this range</div>
        )}
        {hoveredPoint ? (
          <>
            <span
              className="admin-chart-hover-line"
              style={{ left: `${hoveredPoint.position.xPercent}%` }}
            />
            <span
              className="admin-chart-hover-dot"
              style={{
                left: `${hoveredPoint.position.xPercent}%`,
                top: `${hoveredPoint.position.yPercent}%`
              }}
            />
            <div
              className="admin-chart-tooltip"
              style={{
                left: `${Math.min(86, Math.max(14, hoveredPoint.position.xPercent))}%`,
                top: shouldPlaceTooltipBelow
                  ? `${Math.min(72, Math.max(2, hoveredPoint.position.yPercent))}%`
                  : `${Math.min(78, Math.max(18, hoveredPoint.position.yPercent))}%`,
                transform: shouldPlaceTooltipBelow ? "translate(-50%, 0.75rem)" : "translate(-50%, -110%)"
              }}
            >
              <strong>{formatBucketLabel(hoveredPoint.row.bucketStart, props.bucket)}</strong>
              <span>{labelForMetric(props.metric)}: {formatNumber(valueForMetric(hoveredPoint.row, props.metric))}</span>
              <small>
                {formatNumber(hoveredPoint.row.inputTokens)} in · {formatNumber(hoveredPoint.row.outputTokens)} out · {formatNumber(hoveredPoint.row.requestCount)} req
              </small>
              <small>{formatNumber(hoveredPoint.row.weightedTokens)} weighted</small>
            </div>
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

function FilterChecklist(props: {
  title: string;
  options: AdminUsageStatisticsFilterOption[];
  selectedIds: string[];
  searchValue?: string;
  searchPlaceholder?: string;
  onChange: (ids: string[]) => void;
  onSearchChange?: (value: string) => void;
}) {
  return (
    <div className="admin-filter-block">
      <div className="admin-filter-block__head">
        <strong>{props.title}</strong>
        {props.selectedIds.length > 0 ? (
          <button className="btn ghost" type="button" onClick={() => props.onChange([])}>
            Clear
          </button>
        ) : null}
      </div>
      {props.onSearchChange ? (
        <input
          className="admin-filter-search"
          type="search"
          value={props.searchValue ?? ""}
          placeholder={props.searchPlaceholder ?? "Search"}
          onChange={(event) => props.onSearchChange?.(event.target.value)}
        />
      ) : null}
      <div className="admin-filter-options">
        {props.options.length === 0 ? (
          <span className="muted-text">No options in range</span>
        ) : props.options.map((option) => (
          <label key={option.id} className="admin-filter-option">
            <input
              type="checkbox"
              checked={props.selectedIds.includes(option.id)}
              onChange={() => props.onChange(toggleSelection(props.selectedIds, option.id))}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{formatCompactNumber(option.totalTokens)} tokens</small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function BreakdownChart(props: {
  title: string;
  rows: AdminUsageStatisticsBreakdown[];
  selectedIds: string[];
  metric: MetricKey;
  selectionKind: SelectionKind;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
}) {
  const maxValue = Math.max(...props.rows.map((row) => valueForMetric(row, props.metric)), 1);
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
                <span style={{ width: `${Math.max(2, (value / maxValue) * 100)}%` }} />
              </div>
              <div className="admin-bar-row__value">{formatCompactNumber(value)}</div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function StatisticsToolbar(props: {
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
        <option value="totalTokens">Tokens</option>
        <option value="weightedTokens">Weighted tokens</option>
        <option value="requestCount">Requests</option>
      </select>
      <button className="btn ghost" type="button" onClick={props.onRefresh} disabled={props.isLoading}>
        <RefreshCw size={16} />
        Refresh
      </button>
    </div>
  );
}

function buildStatisticsQueryPath(input: {
  range: AdminStatisticsRange;
  bucket: "auto" | AdminStatisticsBucket;
  from: string;
  to: string;
  selectedModels: string[];
  selectedUsers: string[];
  userSearch: string;
}): string {
  const params = new URLSearchParams({ range: input.range });
  if (input.range === "custom") {
    const from = toIsoQueryDate(input.from);
    const to = toIsoQueryDate(input.to);
    if (from) {
      params.set("from", from);
    }
    if (to) {
      params.set("to", to);
    }
  }
  if (input.bucket !== "auto") {
    params.set("bucket", input.bucket);
  }
  if (input.selectedModels.length > 0) {
    params.set("models", input.selectedModels.join(","));
  }
  if (input.selectedUsers.length > 0) {
    params.set("users", input.selectedUsers.join(","));
  }
  const userSearch = input.userSearch.trim();
  if (userSearch.length > 0) {
    params.set("userSearch", userSearch);
  }
  return `/api/admin/statistics/usage?${params.toString()}`;
}

function StatisticsBody(props: {
  usage: AdminUsageStatistics;
  metric: MetricKey;
  selectedModels: string[];
  selectedUsers: string[];
  userSearch: string;
  onSelectedModelsChange: (ids: string[]) => void;
  onSelectedUsersChange: (ids: string[]) => void;
  onUserSearchChange: (value: string) => void;
}) {
  return (
    <>
      <div className="admin-stat-summary">
        <MetricCard
          label="Total tokens"
          value={props.usage.summary.totalTokens}
          detail={`${formatCompactNumber(props.usage.summary.inputTokens)} in`}
        />
        <MetricCard label="Weighted" value={props.usage.summary.weightedTokens} detail="quota-adjusted usage" />
        <MetricCard
          label="Requests"
          value={props.usage.summary.requestCount}
          detail={`${formatNumber(props.usage.summary.averageTokensPerRequest)} avg tokens`}
        />
        <MetricCard
          label="Active users"
          value={props.usage.summary.activeUserCount}
          detail={`${props.usage.summary.modelCount} models`}
        />
      </div>
      <p className="muted-text" style={{ margin: "0.1rem 0 0" }}>{formatRangeLabel(props.usage)}</p>

      <div className="admin-stat-filters">
        <FilterChecklist
          title="Models"
          options={props.usage.filterOptions.models}
          selectedIds={props.selectedModels}
          onChange={props.onSelectedModelsChange}
        />
        <FilterChecklist
          title="Users"
          options={props.usage.filterOptions.users}
          selectedIds={props.selectedUsers}
          searchValue={props.userSearch}
          searchPlaceholder="Search users"
          onChange={props.onSelectedUsersChange}
          onSearchChange={props.onUserSearchChange}
        />
      </div>

      <div className="admin-stat-grid">
        <TimeUsageChart rows={props.usage.timeSeries} bucket={props.usage.range.bucket} metric={props.metric} />
        <BreakdownChart
          title="Usage by model"
          rows={props.usage.modelBreakdown}
          selectedIds={props.selectedModels}
          metric={props.metric}
          selectionKind="models"
        />
        <BreakdownChart
          title="Usage by user"
          rows={props.usage.userBreakdown}
          selectedIds={props.selectedUsers}
          metric={props.metric}
          selectionKind="users"
          searchValue={props.userSearch}
          searchPlaceholder="Search users"
          onSearchChange={props.onUserSearchChange}
        />
      </div>
    </>
  );
}

export function StatisticsSettingsTab() {
  const { api } = useWorkspaceApp();
  const [range, setRange] = useState<AdminStatisticsRange>("30d");
  const [bucket, setBucket] = useState<"auto" | AdminStatisticsBucket>("auto");
  const [metric, setMetric] = useState<MetricKey>("totalTokens");
  const [from, setFrom] = useState(() => formatDateForInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => formatDateForInput(new Date()));
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const debouncedUserSearch = useDebouncedValue(userSearch, 250);
  const [usage, setUsage] = useState<AdminUsageStatistics | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryPath = useMemo(() => {
    return buildStatisticsQueryPath({
      range,
      bucket,
      from,
      to,
      selectedModels,
      selectedUsers,
      userSearch: debouncedUserSearch
    });
  }, [bucket, debouncedUserSearch, from, range, selectedModels, selectedUsers, to]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api.get<AdminUsageStatisticsResponse>(queryPath)
      .then((response) => {
        if (!cancelled) {
          setUsage(response.usage);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, queryPath, refreshNonce]);

  return (
    <div className="admin-statistics-tab">
      <StatisticsToolbar
        range={range}
        bucket={bucket}
        from={from}
        to={to}
        metric={metric}
        isLoading={isLoading}
        onRangeChange={setRange}
        onBucketChange={setBucket}
        onFromChange={setFrom}
        onToChange={setTo}
        onMetricChange={setMetric}
        onRefresh={() => setRefreshNonce((value) => value + 1)}
      />

      {error ? <p className="error-text">{error}</p> : null}
      {usage ? (
        <StatisticsBody
          usage={usage}
          metric={metric}
          selectedModels={selectedModels}
          selectedUsers={selectedUsers}
          userSearch={userSearch}
          onSelectedModelsChange={setSelectedModels}
          onSelectedUsersChange={setSelectedUsers}
          onUserSearchChange={setUserSearch}
        />
      ) : isLoading ? (
        <article className="section-card empty-card">
          <h3>Loading statistics...</h3>
        </article>
      ) : null}
    </div>
  );
}
