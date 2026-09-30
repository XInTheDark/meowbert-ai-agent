import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { badgeClass } from "../../../lib/utils";
import { AdminTable, AdminTableCell, AdminTableRow } from "../../../components/admin/AdminTable";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import type { ApiClient } from "../../../lib/api";
import type { AdminProcessOverview, AdminProcessesResponse, AdminTaskProcessSummary } from "./shared";

const PROCESS_REFRESH_INTERVAL_MS = 10_000;
const PROCESS_COLUMNS = [
  { key: "status", label: "Status", width: "9rem" },
  { key: "task", label: "Task", width: "23rem" },
  { key: "owner", label: "User", width: "18rem" },
  { key: "workspace", label: "Workspace", width: "18rem" },
  { key: "project", label: "Project", width: "18rem" },
  { key: "run", label: "Run", width: "20rem" },
  { key: "timing", label: "Timing", width: "16rem" }
] as const;

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatTaskStatusLabel(status: AdminTaskProcessSummary["taskStatus"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDispatchStateLabel(state: string | null): string {
  if (!state) {
    return "No dispatch";
  }

  return state
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatSourceLabel(source: string): string {
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function resolveOwnerLabel(process: AdminTaskProcessSummary): string {
  if (process.initiatorDisplayName?.trim()) {
    return process.initiatorDisplayName.trim();
  }
  if (process.initiatorEmail?.trim()) {
    return process.initiatorEmail.trim();
  }
  return "System";
}

function resolveTaskHref(process: AdminTaskProcessSummary): string {
  return `/app/${process.workspaceId}/projects/${process.projectId}/tasks/${process.taskId}`;
}

async function fetchAdminProcesses(api: ApiClient): Promise<AdminProcessOverview> {
  const response = await api.get<AdminProcessesResponse>("/api/admin/processes");
  return response.processes;
}

function ProcessMetricCard(props: {
  label: string;
  value: number;
  tone: "good" | "warning" | "muted";
}) {
  return (
    <article className="section-card" style={{ padding: "0.85rem" }}>
      <div className="stack-form" style={{ gap: "0.35rem" }}>
        <span className="muted-text">{props.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <strong style={{ fontSize: "1.4rem" }}>{props.value}</strong>
          <span className={`badge ${props.tone}`}>{props.label}</span>
        </div>
      </div>
    </article>
  );
}

function MetaLine(props: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="muted-text" style={{ marginTop: "0.2rem", wordBreak: "break-word" }}>
      <span>{props.label}: </span>
      <span style={props.monospace ? { fontFamily: "monospace" } : undefined}>{props.value}</span>
    </div>
  );
}

function ProcessRow(props: {
  process: AdminTaskProcessSummary;
}) {
  const { process } = props;

  return (
    <AdminTableRow>
      <AdminTableCell verticalAlign="top">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <span className={badgeClass(process.taskStatus)}>{formatTaskStatusLabel(process.taskStatus)}</span>
          <span className="badge muted">{formatSourceLabel(process.taskSource)}</span>
          {process.workflowType ? <span className="badge muted">{process.workflowType}</span> : null}
        </div>
      </AdminTableCell>

      <AdminTableCell verticalAlign="top">
        <div>
          <Link to={resolveTaskHref(process)}>{process.taskTitle?.trim() || "Untitled task"}</Link>
          <MetaLine label="Task ID" value={process.taskId} monospace />
        </div>
      </AdminTableCell>

      <AdminTableCell verticalAlign="top">
        <div>
          <strong>{resolveOwnerLabel(process)}</strong>
          {process.initiatorEmail ? <MetaLine label="Email" value={process.initiatorEmail} /> : null}
          <MetaLine label="User ID" value={process.initiatorUserId ?? "—"} monospace />
        </div>
      </AdminTableCell>

      <AdminTableCell verticalAlign="top">
        <div>
          <strong>{process.workspaceName}</strong>
          <MetaLine label="Workspace ID" value={process.workspaceId} monospace />
        </div>
      </AdminTableCell>

      <AdminTableCell verticalAlign="top">
        <div>
          <strong>{process.projectName}</strong>
          <MetaLine label="Project ID" value={process.projectId} monospace />
        </div>
      </AdminTableCell>

      <AdminTableCell verticalAlign="top">
        <div>
          <MetaLine label="Run ID" value={process.runId ?? "—"} monospace />
          <MetaLine label="Attempt" value={process.runAttemptNo !== null ? String(process.runAttemptNo) : "—"} />
          <MetaLine label="Mode" value={process.runKind ?? "—"} />
          <MetaLine label="Dispatch" value={formatDispatchStateLabel(process.dispatchQueueState)} />
          <MetaLine label="Worker" value={process.workerId ?? "—"} monospace />
        </div>
      </AdminTableCell>

      <AdminTableCell verticalAlign="top">
        <div>
          <MetaLine label="Updated" value={formatTimestamp(process.updatedAt)} />
          <MetaLine label="Run started" value={formatTimestamp(process.runStartedAt)} />
          <MetaLine label="Queued" value={formatTimestamp(process.dispatchQueuedAt)} />
        </div>
      </AdminTableCell>
    </AdminTableRow>
  );
}

function ProcessesTable(props: {
  overview: AdminProcessOverview;
}) {
  if (props.overview.processes.length === 0) {
    return (
      <article className="section-card" style={{ padding: "1rem" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.35rem" }}>No active tasks</h4>
        <p className="muted-text" style={{ margin: 0 }}>
          Nothing is currently queued, starting, or running.
        </p>
      </article>
    );
  }

  return (
    <AdminTable columns={[...PROCESS_COLUMNS]} minWidth={1700}>
      {props.overview.processes.map((process) => (
        <ProcessRow key={process.taskId} process={process} />
      ))}
    </AdminTable>
  );
}

export function ProcessesTab() {
  const { api } = useWorkspaceApp();
  const isMountedRef = useRef(true);
  const [overview, setOverview] = useState<AdminProcessOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    async function loadInitial(): Promise<void> {
      try {
        const nextOverview = await fetchAdminProcesses(api);
        if (!isMountedRef.current) {
          return;
        }
        setOverview(nextOverview);
        setError(null);
        setLastLoadedAt(new Date().toISOString());
      } catch (err) {
        if (!isMountedRef.current) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    }

    void loadInitial();

    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const nextOverview = await fetchAdminProcesses(api);
          if (!isMountedRef.current) {
            return;
          }
          setOverview(nextOverview);
          setError(null);
          setLastLoadedAt(new Date().toISOString());
        } catch {
          // Preserve the previous snapshot on background refresh failure.
        }
      })();
    }, PROCESS_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [api]);

  async function refreshProcesses(): Promise<void> {
    setIsRefreshing(true);
    try {
      const nextOverview = await fetchAdminProcesses(api);
      if (!isMountedRef.current) {
        return;
      }
      setOverview(nextOverview);
      setError(null);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      if (!isMountedRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }

  if (isLoading) {
    return (
      <article className="section-card empty-card">
        <h4>Loading processes...</h4>
      </article>
    );
  }

  return (
    <div className="stack-form" style={{ gap: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          flexWrap: "wrap"
        }}
      >
        <div>
          <h4 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Processes</h4>
          <p className="muted-text" style={{ margin: 0 }}>
            Live task activity across the platform. This view refreshes every 10 seconds.
          </p>
          {lastLoadedAt ? (
            <p className="muted-text" style={{ margin: "0.35rem 0 0" }}>
              Last refreshed {formatTimestamp(lastLoadedAt)}
            </p>
          ) : null}
        </div>

        <button className="btn ghost" type="button" onClick={() => void refreshProcesses()} disabled={isRefreshing}>
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <article className="section-card" style={{ padding: "0.9rem" }}>
          <p className="error-text" style={{ margin: 0 }}>{error}</p>
        </article>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.75rem"
        }}
      >
        <ProcessMetricCard label="Active" value={overview?.totalCount ?? 0} tone="good" />
        <ProcessMetricCard label="Running" value={overview?.runningCount ?? 0} tone="warning" />
        <ProcessMetricCard label="Starting" value={overview?.startingCount ?? 0} tone="muted" />
        <ProcessMetricCard label="Queued" value={overview?.queuedCount ?? 0} tone="muted" />
      </div>

      {overview ? <ProcessesTable overview={overview} /> : null}
    </div>
  );
}
