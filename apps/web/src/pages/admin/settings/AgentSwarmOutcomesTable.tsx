import { useEffect, useState } from "react";
import type { AgentSwarmOutcomeRow } from "@meowbert/shared/agent-swarm-view";
import { AdminTable, AdminTableCell, AdminTableRow } from "../../../components/admin/AdminTable";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";

const OUTCOME_COLUMNS = [
  { key: "model", label: "Leader model", width: "14rem" },
  { key: "turns", label: "Swarm turns", width: "7rem" },
  { key: "lanes", label: "Lanes per turn", width: "7rem" },
  { key: "mix", label: "Split / diverge / check", width: "11rem" },
  { key: "stopped", label: "Stopped", width: "6rem" },
  { key: "failed", label: "Failed", width: "6rem" },
  { key: "findings", label: "Check findings per turn", width: "9rem" }
] as const;

const percent = (value: number) => `${Math.round(value * 100)}%`;

// Whether leaders on each model use lanes well: how often they fork, which moves they use, how many
// lanes are stopped or fail, and what Check finds.
export function AgentSwarmOutcomesTable() {
  const { api } = useWorkspaceApp();
  const [rows, setRows] = useState<AgentSwarmOutcomeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    void api.get<{ outcomes: AgentSwarmOutcomeRow[] }>("/api/admin/agent-swarm/outcomes")
      .then((response) => setRows(response.outcomes))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)));
  }, [api]);

  return (
    <div className="stack-form" style={{ gap: "0.6rem" }}>
      <strong>Agent Swarm outcomes</strong>
      {error ? <p className="error-text">{error}</p> : null}
      {rows && rows.length === 0 ? <p className="muted-text" style={{ margin: 0 }}>No swarm has used lanes yet.</p> : null}
      {rows && rows.length > 0 ? (
        <AdminTable columns={[...OUTCOME_COLUMNS]} minWidth={720}>
          {rows.map((row) => (
            <AdminTableRow key={row.leaderModel}>
              <AdminTableCell>{row.leaderModel}</AdminTableCell>
              <AdminTableCell align="right">{row.swarmTurns}</AdminTableCell>
              <AdminTableCell align="right">{row.lanesPerTurn.toFixed(1)}</AdminTableCell>
              <AdminTableCell align="right">{row.splitLanes} / {row.divergeLanes} / {row.checkLanes}</AdminTableCell>
              <AdminTableCell align="right">{percent(row.stoppedRate)}</AdminTableCell>
              <AdminTableCell align="right">{percent(row.failedRate)}</AdminTableCell>
              <AdminTableCell align="right">{row.checkFindingsPerTurn.toFixed(1)}</AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTable>
      ) : null}
    </div>
  );
}
