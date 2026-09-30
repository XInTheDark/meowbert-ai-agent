import { toSignedInteger } from "@meowbert/shared";
import { query } from "../../lib/db.js";

export type AdminStatisticsBucket = "hour" | "day" | "week" | "month";
export type AdminStatisticsRange = "24h" | "7d" | "30d" | "90d" | "custom";

export interface AdminUsageStatisticsFilters {
  range: AdminStatisticsRange;
  from?: string;
  to?: string;
  bucket?: AdminStatisticsBucket;
  models: string[];
  users: string[];
  userSearch?: string;
}

export interface AdminUsageStatisticsSummary {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  weightedTokens: number;
  requestCount: number;
  activeUserCount: number;
  modelCount: number;
  averageTokensPerRequest: number;
}

export interface AdminUsageStatisticsPoint {
  bucketStart: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  weightedTokens: number;
  requestCount: number;
}

export interface AdminUsageStatisticsBreakdown {
  id: string;
  label: string;
  detail: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  weightedTokens: number;
  requestCount: number;
}

export interface AdminUsageStatisticsFilterOption {
  id: string;
  label: string;
  detail: string | null;
  requestCount: number;
  totalTokens: number;
}

export interface AdminUsageStatisticsResult {
  range: {
    from: string;
    to: string;
    bucket: AdminStatisticsBucket;
  };
  summary: AdminUsageStatisticsSummary;
  timeSeries: AdminUsageStatisticsPoint[];
  modelBreakdown: AdminUsageStatisticsBreakdown[];
  userBreakdown: AdminUsageStatisticsBreakdown[];
  filterOptions: {
    models: AdminUsageStatisticsFilterOption[];
    users: AdminUsageStatisticsFilterOption[];
  };
}

interface UsageAggregateRow {
  input_tokens: string | number | null;
  cached_input_tokens: string | number | null;
  output_tokens: string | number | null;
  reasoning_tokens: string | number | null;
  total_tokens: string | number | null;
  weighted_tokens: string | number | null;
  request_count: string | number | null;
  active_user_count?: string | number | null;
  model_count?: string | number | null;
}

interface TimeSeriesRow extends UsageAggregateRow {
  bucket_start: Date | string;
}

interface BreakdownRow extends UsageAggregateRow {
  id: string;
  label: string;
  detail: string | null;
}

const BUCKET_INTERVALS: Record<AdminStatisticsBucket, string> = {
  hour: "1 hour",
  day: "1 day",
  week: "1 week",
  month: "1 month"
};

const MAX_CUSTOM_RANGE_MS = 730 * 24 * 60 * 60 * 1000;

function toSafeInteger(value: string | number | null | undefined): number {
  return toSignedInteger(value);
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function resolveTimeRange(input: AdminUsageStatisticsFilters): { from: Date; to: Date } {
  const now = new Date();
  const to = input.range === "custom" ? parseDate(input.to, now) : now;
  const durationMs =
    input.range === "24h" ? 24 * 60 * 60 * 1000
      : input.range === "7d" ? 7 * 24 * 60 * 60 * 1000
        : input.range === "30d" ? 30 * 24 * 60 * 60 * 1000
          : input.range === "90d" ? 90 * 24 * 60 * 60 * 1000
            : MAX_CUSTOM_RANGE_MS;

  const requestedFrom = input.range === "custom"
    ? parseDate(input.from, new Date(to.getTime() - durationMs))
    : new Date(to.getTime() - durationMs);
  const from = requestedFrom < to ? requestedFrom : new Date(to.getTime() - durationMs);
  const clampedFrom = to.getTime() - from.getTime() > MAX_CUSTOM_RANGE_MS
    ? new Date(to.getTime() - MAX_CUSTOM_RANGE_MS)
    : from;

  return { from: clampedFrom, to };
}

function resolveBucket(from: Date, to: Date, requested: AdminStatisticsBucket | undefined): AdminStatisticsBucket {
  if (requested) {
    return requested;
  }

  const durationDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (durationDays <= 2) {
    return "hour";
  }
  if (durationDays <= 120) {
    return "day";
  }
  if (durationDays <= 370) {
    return "week";
  }
  return "month";
}

function aggregateSql(alias = "e"): string {
  return `COALESCE(SUM(${alias}.input_tokens), 0)::text AS input_tokens,
          COALESCE(SUM(${alias}.cached_input_tokens), 0)::text AS cached_input_tokens,
          COALESCE(SUM(${alias}.output_tokens), 0)::text AS output_tokens,
          COALESCE(SUM(${alias}.reasoning_tokens), 0)::text AS reasoning_tokens,
          COALESCE(SUM(${alias}.input_tokens + ${alias}.output_tokens), 0)::text AS total_tokens,
          COALESCE(SUM(${alias}.weighted_tokens), 0)::text AS weighted_tokens,
          COUNT(*)::text AS request_count`;
}

function mapPoint(row: TimeSeriesRow): AdminUsageStatisticsPoint {
  const requestCount = toSafeInteger(row.request_count);
  return {
    bucketStart: new Date(row.bucket_start).toISOString(),
    inputTokens: toSafeInteger(row.input_tokens),
    cachedInputTokens: toSafeInteger(row.cached_input_tokens),
    outputTokens: toSafeInteger(row.output_tokens),
    reasoningTokens: toSafeInteger(row.reasoning_tokens),
    totalTokens: toSafeInteger(row.total_tokens),
    weightedTokens: toSafeInteger(row.weighted_tokens),
    requestCount
  };
}

function mapBreakdown(row: BreakdownRow): AdminUsageStatisticsBreakdown {
  return {
    id: row.id,
    label: row.label,
    detail: row.detail,
    inputTokens: toSafeInteger(row.input_tokens),
    cachedInputTokens: toSafeInteger(row.cached_input_tokens),
    outputTokens: toSafeInteger(row.output_tokens),
    reasoningTokens: toSafeInteger(row.reasoning_tokens),
    totalTokens: toSafeInteger(row.total_tokens),
    weightedTokens: toSafeInteger(row.weighted_tokens),
    requestCount: toSafeInteger(row.request_count)
  };
}

function mapFilterOption(row: BreakdownRow): AdminUsageStatisticsFilterOption {
  return {
    id: row.id,
    label: row.label,
    detail: row.detail,
    requestCount: toSafeInteger(row.request_count),
    totalTokens: toSafeInteger(row.total_tokens)
  };
}

function buildSummary(row: UsageAggregateRow | undefined): AdminUsageStatisticsSummary {
  const requestCount = toSafeInteger(row?.request_count);
  const totalTokens = toSafeInteger(row?.total_tokens);
  return {
    inputTokens: toSafeInteger(row?.input_tokens),
    cachedInputTokens: toSafeInteger(row?.cached_input_tokens),
    outputTokens: toSafeInteger(row?.output_tokens),
    reasoningTokens: toSafeInteger(row?.reasoning_tokens),
    totalTokens,
    weightedTokens: toSafeInteger(row?.weighted_tokens),
    requestCount,
    activeUserCount: toSafeInteger(row?.active_user_count),
    modelCount: toSafeInteger(row?.model_count),
    averageTokensPerRequest: requestCount > 0 ? Math.round(totalTokens / requestCount) : 0
  };
}

interface UsageQueryContext {
  from: Date;
  to: Date;
  bucket: AdminStatisticsBucket;
  params: unknown[];
  filterParams: unknown[];
  userParams: unknown[];
}

function buildUsageQueryContext(input: AdminUsageStatisticsFilters): UsageQueryContext {
  const { from, to } = resolveTimeRange(input);
  const bucket = resolveBucket(from, to, input.bucket);
  const modelFilter = input.models.length > 0 ? input.models : null;
  const userFilter = input.users.length > 0 ? input.users : null;
  const userSearch = input.userSearch?.trim() ? input.userSearch.trim() : null;
  const params = [from.toISOString(), to.toISOString(), modelFilter, userFilter, bucket, BUCKET_INTERVALS[bucket]];

  return {
    from,
    to,
    bucket,
    params,
    filterParams: params.slice(0, 4),
    userParams: [...params.slice(0, 4), userSearch]
  };
}

async function loadUsageSummary(ctx: UsageQueryContext) {
  return query<UsageAggregateRow>(
    `SELECT ${aggregateSql("e")},
            COUNT(DISTINCT e.user_id)::text AS active_user_count,
            COUNT(DISTINCT e.model)::text AS model_count
       FROM user_token_usage_events e
      WHERE e.occurred_at >= $1::timestamptz
        AND e.occurred_at < $2::timestamptz
        AND e.usage_event_kind = 'model_response'
        AND ($3::text[] IS NULL OR e.model = ANY($3::text[]))
        AND ($4::uuid[] IS NULL OR e.user_id = ANY($4::uuid[]))`,
    ctx.filterParams
  );
}

async function loadUsageTimeSeries(ctx: UsageQueryContext) {
  return query<TimeSeriesRow>(
    `WITH buckets AS (
        SELECT generate_series(
          date_trunc($5::text, $1::timestamptz),
          date_trunc($5::text, $2::timestamptz),
          $6::interval
        ) AS bucket_start
      ),
      usage AS (
        SELECT date_trunc($5::text, e.occurred_at) AS bucket_start,
               ${aggregateSql("e")}
          FROM user_token_usage_events e
         WHERE e.occurred_at >= $1::timestamptz
           AND e.occurred_at < $2::timestamptz
           AND e.usage_event_kind = 'model_response'
           AND ($3::text[] IS NULL OR e.model = ANY($3::text[]))
           AND ($4::uuid[] IS NULL OR e.user_id = ANY($4::uuid[]))
         GROUP BY 1
      )
      SELECT b.bucket_start,
             COALESCE(u.input_tokens, '0') AS input_tokens,
             COALESCE(u.cached_input_tokens, '0') AS cached_input_tokens,
             COALESCE(u.output_tokens, '0') AS output_tokens,
             COALESCE(u.reasoning_tokens, '0') AS reasoning_tokens,
             COALESCE(u.total_tokens, '0') AS total_tokens,
             COALESCE(u.weighted_tokens, '0') AS weighted_tokens,
             COALESCE(u.request_count, '0') AS request_count
        FROM buckets b
   LEFT JOIN usage u ON u.bucket_start = b.bucket_start
    ORDER BY b.bucket_start ASC`,
    ctx.params
  );
}

async function loadModelBreakdown(ctx: UsageQueryContext, limit: number, ignoreModelFilter: boolean) {
  const modelClause = ignoreModelFilter
    ? "AND ($3::text[] IS NULL OR $3::text[] IS NOT NULL)"
    : "AND ($3::text[] IS NULL OR e.model = ANY($3::text[]))";
  return query<BreakdownRow>(
    `SELECT e.model AS id,
            e.model AS label,
            NULL::text AS detail,
            ${aggregateSql("e")}
       FROM user_token_usage_events e
      WHERE e.occurred_at >= $1::timestamptz
        AND e.occurred_at < $2::timestamptz
        AND e.usage_event_kind = 'model_response'
        ${modelClause}
        AND ($4::uuid[] IS NULL OR e.user_id = ANY($4::uuid[]))
      GROUP BY e.model
      ORDER BY SUM(e.input_tokens + e.output_tokens) DESC
      LIMIT ${limit}`,
    ctx.filterParams
  );
}

async function loadUserBreakdown(ctx: UsageQueryContext, limit: number, ignoreUserFilter: boolean) {
  const userClause = ignoreUserFilter
    ? "AND ($4::uuid[] IS NULL OR $4::uuid[] IS NOT NULL)"
    : "AND ($4::uuid[] IS NULL OR e.user_id = ANY($4::uuid[]))";
  return query<BreakdownRow>(
    `SELECT e.user_id::text AS id,
            COALESCE(NULLIF(u.display_name, ''), u.email) AS label,
            u.email AS detail,
            ${aggregateSql("e")}
       FROM user_token_usage_events e
       JOIN users u ON u.id = e.user_id
      WHERE e.occurred_at >= $1::timestamptz
        AND e.occurred_at < $2::timestamptz
        AND e.usage_event_kind = 'model_response'
        AND ($3::text[] IS NULL OR e.model = ANY($3::text[]))
        ${userClause}
        AND (
          $5::text IS NULL
          OR u.email ILIKE '%' || $5::text || '%'
          OR u.display_name ILIKE '%' || $5::text || '%'
        )
      GROUP BY e.user_id, u.display_name, u.email
      ORDER BY SUM(e.input_tokens + e.output_tokens) DESC
      LIMIT ${limit}`,
    ctx.userParams
  );
}

export async function getAdminUsageStatistics(input: AdminUsageStatisticsFilters): Promise<AdminUsageStatisticsResult> {
  const ctx = buildUsageQueryContext(input);

  const [summary, timeSeries, modelBreakdown, userBreakdown, modelOptions, userOptions] = await Promise.all([
    loadUsageSummary(ctx),
    loadUsageTimeSeries(ctx),
    loadModelBreakdown(ctx, 50, false),
    loadUserBreakdown(ctx, 50, false),
    loadModelBreakdown(ctx, 80, true),
    loadUserBreakdown(ctx, 80, true)
  ]);

  return {
    range: {
      from: ctx.from.toISOString(),
      to: ctx.to.toISOString(),
      bucket: ctx.bucket
    },
    summary: buildSummary(summary.rows[0]),
    timeSeries: timeSeries.rows.map(mapPoint),
    modelBreakdown: modelBreakdown.rows.map(mapBreakdown),
    userBreakdown: userBreakdown.rows.map(mapBreakdown),
    filterOptions: {
      models: modelOptions.rows.map(mapFilterOption),
      users: userOptions.rows.map(mapFilterOption)
    }
  };
}
