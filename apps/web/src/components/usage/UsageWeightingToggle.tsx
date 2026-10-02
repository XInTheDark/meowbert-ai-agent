import type { TokenUsageWeighting } from "./tokenUsageCategories";

const OPTIONS: Array<{ key: TokenUsageWeighting; label: string; title: string }> = [
  { key: "raw", label: "Tokens", title: "Raw token counts" },
  { key: "weighted", label: "Weighted", title: "Weighted by each model's token prices" }
];

export function UsageWeightingToggle(props: {
  value: TokenUsageWeighting;
  onChange: (value: TokenUsageWeighting) => void;
}) {
  return (
    <div className="admin-segmented-control usage-weighting-toggle" role="group" aria-label="Token weighting">
      {OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          className={props.value === option.key ? "active" : ""}
          title={option.title}
          aria-pressed={props.value === option.key}
          onClick={() => props.onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
