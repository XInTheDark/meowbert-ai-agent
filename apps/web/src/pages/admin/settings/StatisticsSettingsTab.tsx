import { useEffect, useMemo, useState } from "react";
import { computeCacheHitRate } from "@meowbert/shared/token-usage-stats";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import {
  formatCompactNumber,
  formatNumber,
  formatRatioPercent
} from "../../../components/usage/tokenUsageFormat";
import type {
  AdminStatisticsBucket,
  AdminStatisticsRange,
  AdminUsageStatistics,
  AdminUsageStatisticsResponse
} from "./shared";
import { StatisticsBreakdownChart } from "./statistics/StatisticsBreakdownChart";
import { StatisticsFilterChecklist } from "./statistics/StatisticsFilterChecklist";
import { StatisticsTimeChart } from "./statistics/StatisticsTimeChart";
import { StatisticsTokenMixPanel } from "./statistics/StatisticsTokenMixPanel";
import { StatisticsToolbar } from "./statistics/StatisticsToolbar";
import type { MetricKey } from "./statistics/statisticsMetrics";
import { buildStatisticsQueryPath, formatDateForInput } from "./statistics/statisticsQuery";

function formatRangeLabel(usage: AdminUsageStatistics): string {
  const from = new Date(usage.range.from);
  const to = new Date(usage.range.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return `${usage.range.from} to ${usage.range.to}`;
  }
  return `${from.toLocaleDateString()} to ${to.toLocaleDateString()} - ${usage.range.bucket} buckets`;
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}

function MetricCard(props: { label: string; value: string; detail: string }) {
  return (
    <article className="admin-stat-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}

function StatisticsSummaryCards(props: { usage: AdminUsageStatistics }) {
  const summary = props.usage.summary;
  return (
    <div className="admin-stat-summary">
      <MetricCard
        label="Total tokens"
        value={formatCompactNumber(summary.totalTokens)}
        detail={`${formatCompactNumber(summary.inputTokens)} in · ${formatCompactNumber(summary.cachedInputTokens)} cached · ${formatCompactNumber(summary.outputTokens)} out`}
      />
      <MetricCard label="Weighted" value={formatCompactNumber(summary.weightedTokens)} detail="quota-adjusted usage" />
      <MetricCard
        label="Cache hit rate"
        value={formatRatioPercent(computeCacheHitRate(summary))}
        detail={`${formatCompactNumber(summary.cachedInputTokens)} of ${formatCompactNumber(summary.inputTokens + summary.cachedInputTokens)} input`}
      />
      <MetricCard
        label="Requests"
        value={formatCompactNumber(summary.requestCount)}
        detail={`${formatNumber(summary.averageTokensPerRequest)} avg tokens`}
      />
      <MetricCard
        label="Active users"
        value={formatCompactNumber(summary.activeUserCount)}
        detail={`${summary.modelCount} models`}
      />
    </div>
  );
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
      <StatisticsSummaryCards usage={props.usage} />
      <p className="muted-text" style={{ margin: "0.1rem 0 0" }}>{formatRangeLabel(props.usage)}</p>

      <div className="admin-stat-filters">
        <StatisticsFilterChecklist
          title="Models"
          options={props.usage.filterOptions.models}
          selectedIds={props.selectedModels}
          onChange={props.onSelectedModelsChange}
        />
        <StatisticsFilterChecklist
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
        <StatisticsTokenMixPanel totals={props.usage.summary} />
        <StatisticsTimeChart rows={props.usage.timeSeries} bucket={props.usage.range.bucket} metric={props.metric} />
        <StatisticsBreakdownChart
          title="Usage by model"
          rows={props.usage.modelBreakdown}
          selectedIds={props.selectedModels}
          metric={props.metric}
          selectionKind="models"
        />
        <StatisticsBreakdownChart
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
