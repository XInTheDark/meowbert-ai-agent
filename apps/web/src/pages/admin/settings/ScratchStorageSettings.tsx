import { RefreshCw } from "lucide-react";
import { formatBytes } from "../../../lib/utils";
import type { useScratchStorageSettings } from "./useScratchStorageSettings";

export function ScratchStorageSettings({ state }: { state: ReturnType<typeof useScratchStorageSettings> }) {
  const value = state.overview;
  return (
    <section className="section-card" style={{ padding: "1rem" }}>
      <div className="section-head">
        <h4 style={{ margin: 0 }}>Task scratch</h4>
        <button className="btn ghost" type="button" aria-label="Refresh scratch storage" disabled={state.loading || state.saving} onClick={() => void state.refresh()}>
          <RefreshCw size={15} />
        </button>
      </div>
      {value ? <p className="muted-text">{formatBytes(value.usedBytes)} used of {formatBytes(value.effectiveLimitBytes)} budget ({formatBytes(value.capacityBytes)} disk)</p> : null}
      {value?.usage ? <ScratchUsageRows usage={value.usage} /> : null}
      <div className="row-actions" style={{ justifyContent: "flex-start", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <strong>Scratch storage limit (MiB)</strong>
          <input type="number" min="1" step="1" max={value ? Math.floor(value.capacityBytes / 1024 / 1024) : undefined}
            value={state.draft} disabled={!value || state.loading || state.saving} onChange={(event) => state.setDraft(event.target.value)} placeholder="Backing capacity" />
        </label>
        <button className="btn primary" type="button" disabled={!value || state.loading || state.saving} onClick={() => void state.save()}>{state.saving ? "Saving..." : "Save"}</button>
      </div>
      <p className="muted-text" style={{ marginBottom: 0 }}>
        Temporary task files, independent of workspace storage and sandbox images. Blank uses the backing capacity.
        {value ? ` Scratch of finished tasks is cleared after ${value.finishedIdleDays} days idle. Above ${Math.round(value.highWatermark * 100)}%, or with under ${value.minFreeGb} GB free, idle scratch is cleared by size, age and project priority until usage falls below ${Math.round(value.targetWatermark * 100)}%. Active tasks are protected.` : ""}
      </p>
      {state.error ? <p className="error-text">{state.error}</p> : null}
    </section>
  );
}

type ScratchUsage = NonNullable<NonNullable<ReturnType<typeof useScratchStorageSettings>["overview"]>["usage"]>;

function ScratchUsageRows({ usage }: { usage: ScratchUsage }) {
  const rows: Array<[string, number]> = [
    ["Active tasks", usage.activeBytes],
    ["Idle tasks (can be cleared)", usage.idleBytes],
    ["Not tied to a task", usage.untrackedBytes]
  ];
  return (
    <dl className="scratch-usage-rows" style={{ display: "grid", gridTemplateColumns: "max-content max-content", gap: "0.2rem 1rem", margin: "0 0 0.75rem" }}>
      {rows.map(([label, bytes]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt className="muted-text">{label}</dt>
          <dd style={{ margin: 0 }}>{formatBytes(bytes)}</dd>
        </div>
      ))}
    </dl>
  );
}
