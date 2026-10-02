import { useState } from "react";
import type { TokenUsageTotals } from "@meowbert/shared/token-usage-stats";
import { TokenUsageBreakdown } from "../../../../components/usage/TokenUsageBreakdown";
import { UsageWeightingToggle } from "../../../../components/usage/UsageWeightingToggle";
import type { TokenUsageWeighting } from "../../../../components/usage/tokenUsageCategories";

export function StatisticsTokenMixPanel(props: { totals: TokenUsageTotals }) {
  const [weighting, setWeighting] = useState<TokenUsageWeighting>("raw");

  return (
    <article className="admin-stat-panel admin-stat-panel--wide">
      <div className="admin-stat-panel__head">
        <div>
          <h4>Token mix</h4>
          <p className="muted-text">
            {weighting === "weighted"
              ? "Each category's share of weighted usage, priced per model."
              : "Uncached input, cache reads, and output across all requests."}
          </p>
        </div>
        <UsageWeightingToggle value={weighting} onChange={setWeighting} />
      </div>
      <TokenUsageBreakdown totals={props.totals} weighting={weighting} />
    </article>
  );
}
