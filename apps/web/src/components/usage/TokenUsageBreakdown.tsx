import type { TokenUsageTotals } from "@meowbert/shared/token-usage-stats";
import { tokenUsageCategories, type TokenUsageWeighting } from "./tokenUsageCategories";
import { formatCompactNumber, formatNumber, formatRatioPercent } from "./tokenUsageFormat";

export function TokenUsageBreakdown(props: { totals: TokenUsageTotals; weighting: TokenUsageWeighting }) {
  const categories = tokenUsageCategories(props.totals, props.weighting);
  const total = categories.reduce((sum, category) => sum + category.value, 0);

  return (
    <div className="token-usage-breakdown">
      <div className="token-usage-breakdown__bar" aria-hidden="true">
        {total > 0 ? categories.map((category) => (
          <span
            key={category.key}
            className={`token-usage-breakdown__segment token-usage--${category.key}`}
            style={{ width: `${(category.value / total) * 100}%` }}
          />
        )) : null}
      </div>
      <ul className="token-usage-breakdown__legend">
        {categories.map((category) => (
          <li key={category.key} title={formatNumber(category.value)}>
            <span className={`token-usage-breakdown__swatch token-usage--${category.key}`} aria-hidden="true" />
            <span className="token-usage-breakdown__label">{category.label}</span>
            <strong>{formatCompactNumber(category.value)}</strong>
            <small>{formatRatioPercent(total > 0 ? category.value / total : null)}</small>
          </li>
        ))}
      </ul>
      {props.weighting === "raw" && props.totals.reasoningTokens > 0 ? (
        <small className="muted-text">
          Output includes {formatCompactNumber(props.totals.reasoningTokens)} reasoning tokens.
        </small>
      ) : null}
    </div>
  );
}
