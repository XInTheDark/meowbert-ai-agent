import { WASTED_TURN_KIND_LABELS, type WastedTurnsReport } from "@meowbert/shared/wasted-turns";
import { formatCompactNumber, formatNumber, formatRatioPercent } from "../../../../components/usage/tokenUsageFormat";

function Stat(props: { label: string; value: string; title?: string }) {
  return (
    <div className="task-usage-stat" title={props.title}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function WastedTurnsReportView({ report }: { report: WastedTurnsReport }) {
  const { wasted, allTurns } = report;
  return (
    <div className="debug-tool__report">
      <p className="muted-text">
        {report.title ?? report.taskId}
        {report.scopeTaskCount > 1 ? ` · includes ${report.scopeTaskCount - 1} spawned agents` : ""}
      </p>
      {!report.hasTurnDiagnostics ? (
        <p role="status" className="error-text">
          No turn diagnostics were logged for this task. Debug mode was probably off while it ran, so wasted turns can’t be counted.
        </p>
      ) : null}
      <div className="task-usage-stats">
        <Stat label="Wasted turns" value={formatNumber(wasted.turns)} />
        <Stat label="Of all turns" value={formatRatioPercent(ratio(wasted.turns, allTurns.turns))} title={`${formatNumber(allTurns.turns)} turns`} />
        <Stat label="Weighted wasted" value={formatCompactNumber(wasted.weightedTokens)} title={formatNumber(wasted.weightedTokens)} />
        <Stat
          label="Of weighted"
          value={formatRatioPercent(ratio(wasted.weightedTokens, allTurns.weightedTokens))}
          title={`${formatNumber(allTurns.weightedTokens)} weighted`}
        />
      </div>
      {wasted.unmeteredTurns > 0 ? (
        <p className="muted-text">{formatNumber(wasted.unmeteredTurns)} wasted turns had no usage record (BYO provider) and add no weighted tokens.</p>
      ) : null}
      {report.byKind.length > 0 ? (
        <table className="debug-tool__table">
          <thead><tr><th>Cause</th><th>Turns</th><th>Weighted</th></tr></thead>
          <tbody>
            {report.byKind.map((row) => (
              <tr key={row.kind}>
                <td>{WASTED_TURN_KIND_LABELS[row.kind]}</td>
                <td>{formatNumber(row.turns)}</td>
                <td title={formatNumber(row.weightedTokens)}>{formatCompactNumber(row.weightedTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {report.byTask.length > 1 ? (
        <table className="debug-tool__table">
          <thead><tr><th>Agent</th><th>Turns</th><th>Weighted</th></tr></thead>
          <tbody>
            {report.byTask.map((row) => (
              <tr key={row.taskId}>
                <td>{row.title ?? row.taskId}</td>
                <td>{formatNumber(row.turns)}</td>
                <td title={formatNumber(row.weightedTokens)}>{formatCompactNumber(row.weightedTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
