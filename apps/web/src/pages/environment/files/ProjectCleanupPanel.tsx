import type { Dispatch, SetStateAction } from "react";
import type { ProjectCleanupPlanResponse } from "../../../lib/types";
import { formatBytes, formatDateTime } from "../../../lib/utils";
import { EMPTY_CLEANUP_FILTERS, type CleanupFilterFormState } from "./projectFileCleanup";

interface ProjectCleanupPanelProps {
  plan: ProjectCleanupPlanResponse;
  filters: CleanupFilterFormState;
  setFilters: Dispatch<SetStateAction<CleanupFilterFormState>>;
  targetPercent: number;
  setTargetPercent: (value: number) => void;
  selectedPaths: Set<string>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  selectedBytes: number;
  defaultSelectionCount: number;
  isLoading: boolean;
  onLoadPlan: (targetPercent: number, filters: CleanupFilterFormState) => void;
  onDeleteSelected: (paths: string[]) => void;
}

export function ProjectCleanupPanel(props: ProjectCleanupPanelProps) {
  const resetFilters = (): void => {
    const nextFilters = { ...EMPTY_CLEANUP_FILTERS };
    props.setFilters(nextFilters);
    props.onLoadPlan(props.targetPercent, nextFilters);
  };

  return (
    <div className="project-cleanup-panel">
      <div className="project-cleanup-header">
        <div>
          <strong>Cleanup suggestions</strong>
          <div className="muted-text project-cleanup-summary">
            Target {props.plan.targetPercent}% ({formatBytes(props.plan.targetBytes)}) of {formatBytes(props.plan.reclaimableBytes)} reclaimable task-run storage. Showing {props.plan.suggestions.length} candidate(s); {props.defaultSelectionCount} auto-selected for {formatBytes(props.plan.suggestedBytes)}.
          </div>
        </div>
        <div className="row-actions project-cleanup-actions">
          <button className="btn ghost" type="button" onClick={() => props.onLoadPlan(props.targetPercent, props.filters)} disabled={props.isLoading}>
            Apply Filters
          </button>
          <button className="btn ghost" type="button" onClick={resetFilters} disabled={props.isLoading}>
            Reset Filters
          </button>
          <button className="btn ghost danger-outline" type="button" disabled={props.selectedPaths.size === 0} onClick={() => props.onDeleteSelected(Array.from(props.selectedPaths))}>
            Delete Selected
          </button>
        </div>
      </div>

      <div className="project-cleanup-filters">
        <div className="project-cleanup-filter-row">
          <CleanupFilter label="Modified on or after" type="date" value={props.filters.modifiedAfter} onChange={(value) => props.setFilters((current) => ({ ...current, modifiedAfter: value }))} />
          <CleanupFilter label="Modified on or before" type="date" value={props.filters.modifiedBefore} onChange={(value) => props.setFilters((current) => ({ ...current, modifiedBefore: value }))} />
          <CleanupFilter label="Minimum size (MiB)" type="number" value={props.filters.minSizeMb} placeholder="0" onChange={(value) => props.setFilters((current) => ({ ...current, minSizeMb: value }))} />
          <CleanupFilter label="Maximum size (MiB)" type="number" value={props.filters.maxSizeMb} placeholder="Any" onChange={(value) => props.setFilters((current) => ({ ...current, maxSizeMb: value }))} />
        </div>
        <label className="project-cleanup-target">
          <span className="muted-text">Cleanup target: {props.targetPercent}%</span>
          <input type="range" min={1} max={100} value={props.targetPercent} onChange={(event) => props.setTargetPercent(Number(event.target.value))} />
        </label>
      </div>

      <div className="muted-text project-cleanup-selection-summary">
        Selected {props.selectedPaths.size} candidate(s) worth {formatBytes(props.selectedBytes)}.
      </div>
      <CleanupSuggestions plan={props.plan} selectedPaths={props.selectedPaths} setSelectedPaths={props.setSelectedPaths} />
    </div>
  );
}

interface CleanupFilterProps {
  label: string;
  type: "date" | "number";
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

function CleanupFilter(props: CleanupFilterProps) {
  return (
    <label className="project-cleanup-filter">
      <span className="muted-text">{props.label}</span>
      <input type={props.type} min={props.type === "number" ? 0 : undefined} step={props.type === "number" ? 0.1 : undefined} placeholder={props.placeholder} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

function CleanupSuggestions(props: Pick<ProjectCleanupPanelProps, "plan" | "selectedPaths" | "setSelectedPaths">) {
  if (props.plan.suggestions.length === 0) {
    return <div className="muted-text project-cleanup-empty">No eligible task-run directories found for the current filters.</div>;
  }

  return (
    <div className="project-cleanup-suggestions">
      {props.plan.suggestions.map((entry) => (
        <label key={entry.relativePath} className={`project-cleanup-suggestion${props.selectedPaths.has(entry.relativePath) ? " selected" : ""}`}>
          <input
            type="checkbox"
            checked={props.selectedPaths.has(entry.relativePath)}
            onChange={() => props.setSelectedPaths((current) => {
              const next = new Set(current);
              if (next.has(entry.relativePath)) {
                next.delete(entry.relativePath);
              } else {
                next.add(entry.relativePath);
              }
              return next;
            })}
          />
          <div>
            <div className="project-cleanup-suggestion-title">{entry.taskTitle ?? entry.relativePath}</div>
            <div className="muted-text project-cleanup-suggestion-meta">{entry.relativePath}</div>
            <div className="muted-text project-cleanup-suggestion-meta">
              {entry.taskStatus ? entry.taskStatus + " • " : ""}
              {entry.modifiedAt ? formatDateTime(entry.modifiedAt) + " • " : ""}
              {entry.ageDays}d old • score {entry.heuristicScore.toFixed(3)}
            </div>
          </div>
          <div className="muted-text project-cleanup-suggestion-size">{formatBytes(entry.sizeBytes)}</div>
        </label>
      ))}
    </div>
  );
}
