import type { IdleCompactionMode } from "@meowbert/shared/idle-compaction-settings";

interface IdleCompactionModeFieldProps {
  value: IdleCompactionMode;
  onChange: (value: IdleCompactionMode) => void;
}

const MODE_LABELS: Record<IdleCompactionMode, string> = {
  off: "Disabled",
  standard: "Standard",
  full: "Full"
};

export function IdleCompactionModeField(props: IdleCompactionModeFieldProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <strong>Idle compaction for all tasks</strong>
      <p className="muted-text" style={{ marginTop: 0 }}>
        Standard compacts idle top-level tasks while their prompt cache is still warm, like the Project Master. Full also clears
        the context window during a run when its next request comes after the cache expired, such as after a long tool call, a
        swarm wait or a retry, so the expired conversation is not sent again.
        Models with idle_compaction set to false in Model metadata are skipped.
      </p>
      <select
        aria-label="Idle compaction mode"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as IdleCompactionMode)}
        style={{ alignSelf: "flex-start", padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: "4px" }}
      >
        {(Object.keys(MODE_LABELS) as IdleCompactionMode[]).map((mode) => (
          <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
        ))}
      </select>
    </label>
  );
}
