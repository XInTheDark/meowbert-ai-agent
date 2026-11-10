import type { CachebeatMode, CachebeatSettings } from "@meowbert/shared/cachebeat-settings";
import { DraftNumberInput } from "../../../components/forms/DraftNumberInput";

interface CachebeatDurationFieldProps {
  value: CachebeatSettings;
  onChange: (value: CachebeatSettings) => void;
}

const MODE_LABELS: Record<CachebeatMode, string> = {
  off: "Off",
  fixed: "Fixed",
  smart: "Smart"
};

export function CachebeatDurationField(props: CachebeatDurationFieldProps) {
  const { value, onChange } = props;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <strong>Cachebeat duration</strong>
      <p className="muted-text" style={{ marginTop: 0 }}>
        How long an idle Claude task's prompt cache is kept warm after its last request, so continuing doesn't reprocess the whole
        conversation. Idle compaction runs once this ends. Smart keeps it warm longer for large conversations, tasks waiting on a reply,
        tasks someone has open, and tasks with a run scheduled, up to the limit. Needs Meridian with MERIDIAN_CACHE_KEEPALIVE=client.
      </p>
      <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <select
          value={value.mode}
          onChange={(event) => onChange({ ...value, mode: event.target.value as CachebeatMode })}
          style={{ padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: "4px" }}
        >
          {(Object.keys(MODE_LABELS) as CachebeatMode[]).map((mode) => (
            <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
          ))}
        </select>
        {value.mode !== "off" ? (
          <>
            {value.mode === "smart" ? "up to" : null}
            <DraftNumberInput
              min={1}
              max={1440}
              value={Math.max(1, Math.round(value.durationSeconds / 60))}
              onValueChange={(minutes) => onChange({ ...value, durationSeconds: minutes * 60 })}
              style={{ width: "10rem", padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: "4px" }}
            />
            minutes
          </>
        ) : null}
      </span>
    </label>
  );
}
