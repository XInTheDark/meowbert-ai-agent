import type { AdminRuntimeMigrationSummary } from "./shared";

interface MigrationsSettingsTabProps {
  migrations: AdminRuntimeMigrationSummary[];
  isRunningMigrationKey: string | null;
  isSaving: boolean;
  onRunMigration: (migrationKey: AdminRuntimeMigrationSummary["key"]) => Promise<void>;
}

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

function formatStatusLabel(status: AdminRuntimeMigrationSummary["status"]): string {
  if (status === "action_required") {
    return "Action Required";
  }
  if (status === "up_to_date") {
    return "Up to Date";
  }
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}

function resolveStatusBadgeClass(status: AdminRuntimeMigrationSummary["status"]): string {
  if (status === "up_to_date" || status === "ready") {
    return "good";
  }
  if (status === "queued" || status === "running") {
    return "warning";
  }
  return "danger";
}

export function MigrationsSettingsTab(props: MigrationsSettingsTabProps) {
  if (props.migrations.length === 0) {
    return <p className="muted-text" style={{ margin: 0 }}>No admin migrations are available.</p>;
  }

  return (
    <div className="stack-form" style={{ gap: "0.9rem" }}>
      {props.migrations.map((migration) => {
        const latestRun = migration.latestRun;
        const isRunning = props.isRunningMigrationKey === migration.key;
        const canRun = !migration.blockedReason && migration.status !== "queued" && migration.status !== "running" && !isRunning;

        return (
          <article key={migration.key} className="section-card" style={{ padding: "0.95rem" }}>
            <div className="stack-form" style={{ gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: "1 1 18rem" }}>
                  <strong style={{ display: "block", overflowWrap: "anywhere" }}>{migration.title}</strong>
                </div>
                <span className={`badge ${resolveStatusBadgeClass(migration.status)}`} style={{ flexShrink: 0 }}>
                  {formatStatusLabel(migration.status)}
                </span>
              </div>

              <div style={{ minWidth: 0 }}>
                <p className="muted-text" style={{ marginTop: 0, marginBottom: 0 }}>
                  {migration.description}
                </p>
                <p className="muted-text" style={{ marginTop: "0.45rem", marginBottom: 0 }}>
                  {migration.detail}
                </p>
                <p className="muted-text" style={{ marginTop: "0.45rem", marginBottom: 0 }}>
                  Pending items: {migration.pendingItems}
                </p>
                {migration.blockedReason ? (
                  <p className="muted-text" style={{ marginTop: "0.45rem", marginBottom: 0, whiteSpace: "pre-wrap" }}>
                    {migration.blockedReason}
                  </p>
                ) : null}
                {latestRun ? (
                  <p className="muted-text" style={{ marginTop: "0.45rem", marginBottom: 0, whiteSpace: "pre-wrap" }}>
                    Latest run: {latestRun.status} · {formatTimestamp(latestRun.updatedAt)}
                    {latestRun.errorSummary ? ` · ${latestRun.errorSummary}` : ""}
                  </p>
                ) : null}
              </div>

              <div className="row-actions" style={{ justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                <div className="muted-text" style={{ margin: 0, minWidth: 0, flex: "1 1 18rem", overflowWrap: "anywhere" }}>
                  Started: {formatTimestamp(latestRun?.startedAt ?? null)} · Completed: {formatTimestamp(latestRun?.completedAt ?? null)}
                </div>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void props.onRunMigration(migration.key)}
                  disabled={!canRun || props.isSaving}
                  style={{ flexShrink: 0, marginLeft: "auto" }}
                >
                  {isRunning ? "Queueing..." : migration.status === "up_to_date" ? "Run Again" : "Run Migration"}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
