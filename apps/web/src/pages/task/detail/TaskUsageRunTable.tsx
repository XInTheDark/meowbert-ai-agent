import type { ReactNode } from "react";
import {
  computeCacheHitRate,
  type TaskUsageRun,
  type TaskUsageSpawnedTotals,
  type TokenUsageTotals
} from "@meowbert/shared/token-usage-stats";
import { tokenUsageCategories, type TokenUsageWeighting } from "../../../components/usage/tokenUsageCategories";
import { formatCompactNumber, formatNumber, formatRatioPercent } from "../../../components/usage/tokenUsageFormat";
import { formatDateTime } from "../../../lib/utils";

function TaskUsageRow(props: { label: ReactNode; totals: TokenUsageTotals; weighting: TokenUsageWeighting }) {
  const categories = tokenUsageCategories(props.totals, props.weighting);

  return (
    <tr>
      <td>{props.label}</td>
      <td>{formatNumber(props.totals.requestCount)}</td>
      {categories.map((category) => (
        <td key={category.key} title={formatNumber(category.value)}>{formatCompactNumber(category.value)}</td>
      ))}
      <td>{formatRatioPercent(computeCacheHitRate(props.totals))}</td>
      <td title={formatNumber(props.totals.weightedTokens)}>{formatCompactNumber(props.totals.weightedTokens)}</td>
    </tr>
  );
}

function TaskUsageRunRow(props: { run: TaskUsageRun; weighting: TokenUsageWeighting }) {
  const isDefaultRun = !props.run.runKind || props.run.runKind === "default";
  const label = (
    <>
      <span className="task-usage-run-label">
        <strong>{formatDateTime(props.run.startedAt)}</strong>
        {!isDefaultRun ? <span className="badge muted">{props.run.runKind}</span> : null}
      </span>
      {props.run.models.length > 0 ? <small>{props.run.models.join(", ")}</small> : null}
    </>
  );

  return <TaskUsageRow label={label} totals={props.run} weighting={props.weighting} />;
}

function TaskUsageSpawnedRow(props: { spawned: TaskUsageSpawnedTotals; weighting: TokenUsageWeighting }) {
  const agentLabel = props.spawned.taskCount === 1 ? "1 agent" : `${formatNumber(props.spawned.taskCount)} agents`;
  const label = (
    <>
      <span className="task-usage-run-label"><strong>Spawned agents</strong></span>
      <small>{agentLabel}</small>
    </>
  );

  return <TaskUsageRow label={label} totals={props.spawned} weighting={props.weighting} />;
}

export function TaskUsageRunTable(props: {
  runs: TaskUsageRun[];
  runCount: number;
  spawned: TaskUsageSpawnedTotals;
  weighting: TokenUsageWeighting;
}) {
  return (
    <div className="task-usage-runs">
      <div className="task-usage-runs__scroll">
        <table className="task-usage-runs__table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Req</th>
              <th>Input</th>
              <th>Cached</th>
              <th>Output</th>
              <th>Hit</th>
              <th>Weighted</th>
            </tr>
          </thead>
          <tbody>
            {props.spawned.requestCount > 0 ? (
              <TaskUsageSpawnedRow spawned={props.spawned} weighting={props.weighting} />
            ) : null}
            {props.runs.map((run) => (
              <TaskUsageRunRow key={run.runId ?? run.startedAt} run={run} weighting={props.weighting} />
            ))}
          </tbody>
        </table>
      </div>
      {props.runCount > props.runs.length ? (
        <small className="muted-text">Showing the latest {props.runs.length} of {props.runCount} runs.</small>
      ) : null}
    </div>
  );
}
