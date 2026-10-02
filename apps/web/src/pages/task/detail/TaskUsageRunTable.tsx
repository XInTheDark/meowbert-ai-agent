import { computeCacheHitRate, type TaskUsageRun } from "@meowbert/shared/token-usage-stats";
import { tokenUsageCategories, type TokenUsageWeighting } from "../../../components/usage/tokenUsageCategories";
import { formatCompactNumber, formatNumber, formatRatioPercent } from "../../../components/usage/tokenUsageFormat";
import { formatDateTime } from "../../../lib/utils";

function TaskUsageRunRow(props: { run: TaskUsageRun; weighting: TokenUsageWeighting }) {
  const categories = tokenUsageCategories(props.run, props.weighting);
  const isDefaultRun = !props.run.runKind || props.run.runKind === "default";

  return (
    <tr>
      <td>
        <span className="task-usage-run-label">
          <strong>{formatDateTime(props.run.startedAt)}</strong>
          {!isDefaultRun ? <span className="badge muted">{props.run.runKind}</span> : null}
        </span>
        {props.run.models.length > 0 ? <small>{props.run.models.join(", ")}</small> : null}
      </td>
      <td>{formatNumber(props.run.requestCount)}</td>
      {categories.map((category) => (
        <td key={category.key} title={formatNumber(category.value)}>{formatCompactNumber(category.value)}</td>
      ))}
      <td>{formatRatioPercent(computeCacheHitRate(props.run))}</td>
      <td title={formatNumber(props.run.weightedTokens)}>{formatCompactNumber(props.run.weightedTokens)}</td>
    </tr>
  );
}

export function TaskUsageRunTable(props: { runs: TaskUsageRun[]; runCount: number; weighting: TokenUsageWeighting }) {
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
