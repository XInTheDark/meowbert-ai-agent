import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useOptionalWorkspaceApp, useWorkspaceApp } from "../contexts/WorkspaceContext";

export interface SubscriptionUsageLimitStatus {
  weightedTokens: number;
  durationDays: number;
  used: number;
  remaining: number;
  percentUsed: number;
  percentRemaining: number;
  windowStartUtc: string;
  resetAtUtc: string;
  exceeded: boolean;
}

interface SubscriptionUsageResponse {
  mode: "admin_exempt" | "byo" | "subscription" | "free";
  usage: {
    limits?: SubscriptionUsageLimitStatus[];
  };
}

export interface SubscriptionUsageWarning {
  label: string;
  reached: boolean;
}

export function getSubscriptionUsageWarning(
  summary: SubscriptionUsageResponse | null,
  thresholdPercent = 80
): SubscriptionUsageWarning | null {
  if (!summary || summary.mode !== "subscription") {
    return null;
  }

  const limits = summary.usage.limits ?? [];
  const worstLimit = limits
    .filter((limit) => limit.weightedTokens > 0)
    .sort((left, right) => right.percentUsed - left.percentUsed)[0];

  if (!worstLimit || worstLimit.percentUsed < thresholdPercent) {
    return null;
  }

  return {
    label: worstLimit.exceeded ? "Usage limit reached" : "Usage limit nearing",
    reached: worstLimit.exceeded
  };
}

export function useSubscriptionUsageWarning(): SubscriptionUsageWarning | null {
  const { api } = useWorkspaceApp();
  const [summary, setSummary] = useState<SubscriptionUsageResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<SubscriptionUsageResponse>("/api/subscription")
      .then((response) => {
        if (!cancelled) {
          setSummary(response);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  return useMemo(() => getSubscriptionUsageWarning(summary), [summary]);
}

export function SubscriptionUsageWarningLink(props: {
  warning: SubscriptionUsageWarning | null;
  className?: string;
}) {
  // This renders nothing without a warning, so it must not hard-require the
  // workspace context just to bail out.
  const activeWorkspaceId = useOptionalWorkspaceApp()?.activeWorkspaceId;
  if (!props.warning || !activeWorkspaceId) {
    return null;
  }

  return (
    <Link className={props.className ?? "subscription-usage-warning-link"} to={`/app/${activeWorkspaceId}/subscription`}>
      <AlertCircle size={15} />
      <span>{props.warning.label}</span>
      <ArrowUpRight size={14} />
    </Link>
  );
}
