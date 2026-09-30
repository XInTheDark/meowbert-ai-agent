import { RefreshCw } from "lucide-react";
import { formatBytes } from "../../../lib/utils";
import type {
  AdminHostStorageOverview,
  AdminTaskHistoryArchiveRun
} from "./shared";

interface HostStorageSettingsTabProps {
  overview: AdminHostStorageOverview | null;
  warmRetentionDaysDraft: string;
  isLoading: boolean;
  isSavingRetention: boolean;
  isPruningEvents: boolean;
  isVacuumingEvents: boolean;
  isQueueingArchive: boolean;
  error: string | null;
  onWarmRetentionDaysDraftChange: (value: string) => void;
  onRefresh: () => Promise<void>;
  onSaveWarmRetentionDays: () => Promise<void>;
  onPruneEventsNow: () => Promise<void>;
  onVacuumFullTaskEvents: () => Promise<void>;
  onArchiveNextEligibleTask: () => Promise<void>;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function statusTone(status: AdminTaskHistoryArchiveRun["status"]): string {
  if (status === "completed") return "good";
  if (status === "failed") return "warning";
  return "muted";
}

function MetricCard(props: { label: string; value: string; detail?: string }) {
  return (
    <article className="section-card" style={{ padding: "0.85rem" }}>
      <div className="stack-form" style={{ gap: "0.3rem" }}>
        <span className="muted-text">{props.label}</span>
        <strong style={{ fontSize: "1.2rem" }}>{props.value}</strong>
        {props.detail ? <span className="muted-text">{props.detail}</span> : null}
      </div>
    </article>
  );
}

function PostgresStorageSection(props: { overview: AdminHostStorageOverview }) {
  const eventRelation = props.overview.postgres.relations.find((relation) => relation.name === "task_events");
  return (
    <section className="section-card" style={{ padding: "1rem" }}>
      <div className="section-head">
        <div>
          <h4 style={{ margin: 0 }}>PostgreSQL</h4>
          <p className="muted-text" style={{ marginTop: "0.35rem" }}>
            Database and largest-table sizes reported by PostgreSQL.
          </p>
        </div>
      </div>
      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <MetricCard label="Database" value={formatBytes(props.overview.postgres.databaseBytes)} detail={props.overview.postgres.databaseName} />
        <MetricCard
          label="Task events"
          value={formatBytes(eventRelation?.totalBytes)}
          detail={eventRelation ? `${formatCount(eventRelation.estimatedLiveRows)} estimated rows` : "Table unavailable"}
        />
        <MetricCard
          label="Task event dead rows"
          value={eventRelation ? formatCount(eventRelation.estimatedDeadRows) : "—"}
          detail={eventRelation ? `Last autovacuum: ${formatDate(eventRelation.lastAutovacuumAt)}` : undefined}
        />
      </div>
      <div style={{ overflowX: "auto", marginTop: "1rem" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Relation</th>
              <th>Table</th>
              <th>Indexes</th>
              <th>Total</th>
              <th>Live rows</th>
              <th>Dead rows</th>
            </tr>
          </thead>
          <tbody>
            {props.overview.postgres.relations.map((relation) => (
              <tr key={relation.name}>
                <td><code>{relation.name}</code></td>
                <td>{formatBytes(relation.tableBytes)}</td>
                <td>{formatBytes(relation.indexBytes)}</td>
                <td><strong>{formatBytes(relation.totalBytes)}</strong></td>
                <td>{formatCount(relation.estimatedLiveRows)}</td>
                <td>{formatCount(relation.estimatedDeadRows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventRetentionSection(props: {
  overview: AdminHostStorageOverview;
  isPruning: boolean;
  isVacuuming: boolean;
  onPrune: () => Promise<void>;
  onVacuumFull: () => Promise<void>;
}) {
  const retention = props.overview.eventRetention;
  return (
    <section className="section-card" style={{ padding: "1rem" }}>
      <div className="section-head">
        <div>
          <h4 style={{ margin: 0 }}>Task event retention</h4>
          <p className="muted-text" style={{ marginTop: "0.35rem" }}>
            Keeps the newest {retention.retainedEventsPerTask} events per task. Each insert prunes up to {formatCount(retention.insertPruneBatchSize)} older events for that task.
          </p>
          <p className="muted-text" style={{ marginTop: "0.35rem" }}>
            Existing backlog drains in {formatCount(retention.backlogDeleteBatchSize)}-row batches every {retention.backlogIntervalSeconds} seconds, then falls back to a safety check every {retention.safetyIntervalHours} hours.
          </p>
        </div>
        <span className={`badge ${retention.pruningEnabled ? "good" : "warning"}`}>
          {retention.pruningEnabled ? "Active" : "Paused by debug mode"}
        </span>
      </div>
      <div className="row-actions" style={{ justifyContent: "flex-start" }}>
        <button
          className="btn primary"
          type="button"
          disabled={props.isPruning || !retention.pruningEnabled}
          onClick={() => void props.onPrune()}
        >
          {props.isPruning ? "Pruning..." : "Prune one batch now"}
        </button>
      </div>
      <p className="muted-text" style={{ marginBottom: 0 }}>
        Pruning makes old rows reusable inside PostgreSQL but does not shrink the host files.
      </p>
      <div className="stack-form" style={{ gap: "0.6rem", marginTop: "1rem" }}>
        <div>
          <strong>Physically reclaim disk</strong>
          <p className="muted-text" style={{ margin: "0.3rem 0 0" }}>
            Run this after pruning has drained the excess rows. VACUUM FULL rewrites <code>task_events</code> and takes an exclusive lock. Task event reads and writes will wait, and PostgreSQL may temporarily need free disk close to the current table size.
          </p>
        </div>
        <div className="row-actions" style={{ justifyContent: "flex-start" }}>
          <button
            className="btn danger-outline"
            type="button"
            disabled={props.isVacuuming || props.isPruning}
            onClick={() => void props.onVacuumFull()}
          >
            {props.isVacuuming ? "Reclaiming disk..." : "Run VACUUM FULL"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ArchiveRunHistory(props: { runs: AdminTaskHistoryArchiveRun[] }) {
  if (props.runs.length === 0) {
    return <p className="muted-text">No cold-storage archive runs have been recorded yet.</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Started</th>
            <th>Completed</th>
            <th>Task</th>
            <th>Source</th>
            <th>Status</th>
            <th>Original</th>
            <th>Compressed</th>
            <th>Contents</th>
          </tr>
        </thead>
        <tbody>
          {props.runs.map((run) => {
            const itemCount = (run.messageCount ?? 0) + (run.eventCount ?? 0)
              + (run.revisionCount ?? 0) + (run.workflowMessageCount ?? 0);
            return (
              <tr key={run.id}>
                <td>{formatDate(run.startedAt ?? run.createdAt)}</td>
                <td>{formatDate(run.completedAt)}</td>
                <td title={run.taskId ?? undefined}>{run.taskTitle ?? run.taskId ?? "Pending selection"}</td>
                <td>{run.triggerSource}</td>
                <td>
                  <span className={`badge ${statusTone(run.status)}`}>{run.status}</span>
                  {run.errorSummary ? <div className="muted-text" style={{ marginTop: "0.3rem" }}>{run.errorSummary}</div> : null}
                </td>
                <td>{formatBytes(run.originalSizeBytes)}</td>
                <td>{formatBytes(run.compressedSizeBytes)}</td>
                <td>{itemCount > 0 ? formatCount(itemCount) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ColdStorageSection(props: {
  overview: AdminHostStorageOverview;
  warmRetentionDaysDraft: string;
  isSavingRetention: boolean;
  isQueueingArchive: boolean;
  onWarmRetentionDaysDraftChange: (value: string) => void;
  onSaveWarmRetentionDays: () => Promise<void>;
  onArchiveNextEligibleTask: () => Promise<void>;
}) {
  const archive = props.overview.taskHistoryArchive;
  return (
    <section className="section-card" style={{ padding: "1rem" }}>
      <div className="section-head">
        <div>
          <h4 style={{ margin: 0 }}>Task-history cold storage</h4>
          <p className="muted-text" style={{ marginTop: "0.35rem" }}>
            Compresses inactive task payloads to the mounted archive and restores them when needed.
          </p>
        </div>
        <span className={`badge ${archive.healthState === "ready" ? "good" : archive.healthState === "disabled" ? "muted" : "warning"}`}>
          {archive.healthState}
        </span>
      </div>
      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <MetricCard label="Eligible now" value={formatCount(archive.eligibleTaskCount)} />
        <MetricCard label="Archived" value={formatCount(archive.archivedTaskCount)} />
        <MetricCard label="Warm" value={formatCount(archive.warmTaskCount)} />
        <MetricCard label="Failed attempts" value={formatCount(archive.failedTaskCount)} />
      </div>
      <div className="stack-form" style={{ gap: "0.35rem", marginTop: "1rem" }}>
        <p className="muted-text" style={{ margin: 0, wordBreak: "break-word" }}>Mount: {archive.mountPath ?? "Not configured"}</p>
        <p className="muted-text" style={{ margin: 0, wordBreak: "break-word" }}>Archive root: {archive.rootPath ?? "Not configured"}</p>
        {archive.healthMessage ? <p className="muted-text" style={{ margin: 0 }}>{archive.healthMessage}</p> : null}
      </div>
      <div className="row-actions" style={{ justifyContent: "flex-start", alignItems: "flex-end", marginTop: "1rem" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <strong>Warm retention (days)</strong>
          <input
            type="number"
            min={0}
            max={3650}
            step={1}
            value={props.warmRetentionDaysDraft}
            disabled={props.isSavingRetention}
            onChange={(event) => props.onWarmRetentionDaysDraftChange(event.target.value)}
            style={{ width: "10rem" }}
          />
          <span className="muted-text">0 turns automatic archiving off; a positive value turns it on.</span>
        </label>
        <button className="btn ghost" type="button" disabled={props.isSavingRetention} onClick={() => void props.onSaveWarmRetentionDays()}>
          {props.isSavingRetention ? "Saving..." : "Save retention"}
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={props.isQueueingArchive || archive.healthState !== "ready" || archive.warmRetentionDays <= 0}
          onClick={() => void props.onArchiveNextEligibleTask()}
        >
          {props.isQueueingArchive ? "Queueing..." : "Archive next eligible task"}
        </button>
      </div>
      <div style={{ marginTop: "1.25rem" }}>
        <h5 style={{ margin: "0 0 0.75rem" }}>Recent archive runs</h5>
        <ArchiveRunHistory runs={archive.recentRuns} />
      </div>
    </section>
  );
}

export function HostStorageSettingsTab(props: HostStorageSettingsTabProps) {
  if (!props.overview) {
    return (
      <div className="stack-form">
        <p className="muted-text">{props.isLoading ? "Loading host storage..." : "Host storage metrics are unavailable."}</p>
        {props.error ? <p className="error-text">{props.error}</p> : null}
        {!props.isLoading ? (
          <button className="btn ghost" type="button" onClick={() => void props.onRefresh()}>Retry</button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="stack-form" style={{ gap: "1rem" }}>
      <div className="section-head">
        <div>
          <h4 style={{ margin: 0 }}>Host storage</h4>
          <p className="muted-text" style={{ marginTop: "0.35rem" }}>PostgreSQL retention and task-history cold storage.</p>
        </div>
        <button className="btn ghost" type="button" disabled={props.isLoading} onClick={() => void props.onRefresh()}>
          <RefreshCw size={15} />
          {props.isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {props.error ? <p className="error-text">{props.error}</p> : null}
      <PostgresStorageSection overview={props.overview} />
      <EventRetentionSection
        overview={props.overview}
        isPruning={props.isPruningEvents}
        isVacuuming={props.isVacuumingEvents}
        onPrune={props.onPruneEventsNow}
        onVacuumFull={props.onVacuumFullTaskEvents}
      />
      <ColdStorageSection
        overview={props.overview}
        warmRetentionDaysDraft={props.warmRetentionDaysDraft}
        isSavingRetention={props.isSavingRetention}
        isQueueingArchive={props.isQueueingArchive}
        onWarmRetentionDaysDraftChange={props.onWarmRetentionDaysDraftChange}
        onSaveWarmRetentionDays={props.onSaveWarmRetentionDays}
        onArchiveNextEligibleTask={props.onArchiveNextEligibleTask}
      />
    </div>
  );
}
