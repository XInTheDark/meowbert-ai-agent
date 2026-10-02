import { formatCompactNumber } from "../../../../components/usage/tokenUsageFormat";
import type { AdminUsageStatisticsFilterOption } from "../shared";

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

export function StatisticsFilterChecklist(props: {
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
