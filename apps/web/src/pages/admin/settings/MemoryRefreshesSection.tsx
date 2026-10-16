import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminTable, AdminTableCell, AdminTableRow } from "../../../components/admin/AdminTable";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import { badgeClass } from "../../../lib/utils";

interface MemoryRefreshSummary {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  taskId: string | null;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  initiatorLabel: string | null;
  errorSummary: string | null;
  createdAt: string;
  completedAt: string | null;
}

const COLUMNS = [
  { key: "status", label: "Status", width: "8rem" },
  { key: "task", label: "Refresh", width: "16rem" },
  { key: "project", label: "Project", width: "20rem" },
  { key: "user", label: "Triggered by", width: "14rem" },
  { key: "timing", label: "Started / finished", width: "16rem" }
];

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function MemoryRefreshRow({ refresh }: { refresh: MemoryRefreshSummary }) {
  const taskHref = refresh.taskId
    ? `/app/${refresh.workspaceId}/projects/${refresh.projectId}/tasks/${refresh.taskId}`
    : null;

  return (
    <AdminTableRow>
      <AdminTableCell verticalAlign="top">
        <span className={badgeClass(refresh.status)}>{refresh.status}</span>
      </AdminTableCell>
      <AdminTableCell verticalAlign="top">
        {taskHref ? <Link to={taskHref}>Open task</Link> : <span className="muted-text">No task</span>}
        {refresh.errorSummary ? <p className="error-text" style={{ margin: "0.3rem 0 0" }}>{refresh.errorSummary}</p> : null}
      </AdminTableCell>
      <AdminTableCell verticalAlign="top">
        <strong>{refresh.projectName}</strong>
        <div className="muted-text">{refresh.workspaceName}</div>
      </AdminTableCell>
      <AdminTableCell verticalAlign="top">{refresh.initiatorLabel ?? "System"}</AdminTableCell>
      <AdminTableCell verticalAlign="top">
        <div>{formatTime(refresh.createdAt)}</div>
        <div className="muted-text">{formatTime(refresh.completedAt)}</div>
      </AdminTableCell>
    </AdminTableRow>
  );
}

export function MemoryRefreshesSection({ reloadKey }: { reloadKey: string | null }) {
  const { api } = useWorkspaceApp();
  const [refreshes, setRefreshes] = useState<MemoryRefreshSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.get<{ refreshes: MemoryRefreshSummary[] }>("/api/admin/memory-refreshes")
      .then((response) => {
        if (!cancelled) {
          setRefreshes(response.refreshes);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => { cancelled = true; };
  }, [api, reloadKey]);

  return (
    <section style={{ display: "grid", gap: "0.6rem" }}>
      <h4 style={{ margin: 0 }}>Recent memory refreshes</h4>
      {error ? <p className="error-text" style={{ margin: 0 }}>{error}</p> : null}
      {refreshes && refreshes.length === 0 ? <p className="muted-text" style={{ margin: 0 }}>No memory refreshes yet.</p> : null}
      {refreshes && refreshes.length > 0 ? (
        <AdminTable columns={COLUMNS} minWidth={900}>
          {refreshes.map((refresh) => <MemoryRefreshRow key={refresh.id} refresh={refresh} />)}
        </AdminTable>
      ) : null}
    </section>
  );
}
