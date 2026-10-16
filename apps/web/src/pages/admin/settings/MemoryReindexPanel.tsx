import { useState } from "react";
import { RefreshCw, Square } from "lucide-react";
import {
  MEMORY_REINDEX_DEFAULT_CONCURRENCY,
  MEMORY_REINDEX_MAX_CONCURRENCY,
  type MemoryReindexJob
} from "@meowbert/shared/memory-embeddings";
import { isReindexActive } from "./useAdminMemoryEmbeddings";

interface MemoryReindexPanelProps {
  job: MemoryReindexJob | null;
  disabled: boolean;
  onStart: (concurrency: number) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
}

const STATUS_LABELS: Record<MemoryReindexJob["status"], string> = {
  queued: "Waiting for a worker",
  running: "Re-indexing",
  succeeded: "Finished",
  failed: "Finished with errors",
  cancelled: "Cancelled"
};

function ReindexProgress({ job }: { job: MemoryReindexJob }) {
  const processed = job.completedWorkspaces + job.failedWorkspaces;
  const percent = job.totalWorkspaces > 0 ? Math.round((processed / job.totalWorkspaces) * 100) : 0;

  return (
    <div className="admin-reindex-progress" role="status">
      <div className="admin-reindex-progress__summary">
        <strong>{STATUS_LABELS[job.status]}</strong>
        <span className="muted-text">
          {processed} / {job.totalWorkspaces} workspaces
          {job.failedWorkspaces > 0 ? ` · ${job.failedWorkspaces} failed` : ""}
          {` · ${job.concurrency} at a time`}
        </span>
      </div>
      <progress max={100} value={percent} aria-label="Re-index progress" />
      {job.activeWorkspaces.length > 0 ? (
        <p className="muted-text">Now: {job.activeWorkspaces.join(", ")}</p>
      ) : null}
      {job.errors.length > 0 ? (
        <ul className="admin-reindex-errors">
          {job.errors.map((entry, index) => (
            <li key={`${entry.workspace}-${index}`}><strong>{entry.workspace}</strong>: {entry.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function MemoryReindexPanel({ job, disabled, onStart, onCancel }: MemoryReindexPanelProps) {
  const [concurrency, setConcurrency] = useState(MEMORY_REINDEX_DEFAULT_CONCURRENCY);
  const active = isReindexActive(job);

  function start() {
    const confirmed = window.confirm(
      "Wipe every Memory index and rebuild it with the current embedding settings? Memory search returns fewer results until each workspace finishes."
    );
    if (confirmed) {
      void onStart(concurrency);
    }
  }

  return (
    <section className="admin-reindex" aria-labelledby="memory-reindex-title">
      <div>
        <h3 id="memory-reindex-title">Re-index all Memory</h3>
        <p className="muted-text">Use after switching embedding models. Every workspace's index is wiped and rebuilt.</p>
      </div>
      <div className="admin-reindex__controls">
        <label>
          <span>Workspaces at once</span>
          <input type="number" min={1} max={MEMORY_REINDEX_MAX_CONCURRENCY} value={concurrency} disabled={disabled || active}
            onChange={(event) => setConcurrency(Math.min(MEMORY_REINDEX_MAX_CONCURRENCY, Math.max(1, Number(event.target.value) || 1)))} />
        </label>
        {active ? (
          <button type="button" className="btn ghost" disabled={disabled} onClick={() => void onCancel()}>
            <Square size={16} /> Cancel
          </button>
        ) : (
          <button type="button" className="btn danger-outline" disabled={disabled} onClick={start}>
            <RefreshCw size={16} /> Wipe &amp; re-index
          </button>
        )}
      </div>
      {job ? <ReindexProgress job={job} /> : null}
    </section>
  );
}
