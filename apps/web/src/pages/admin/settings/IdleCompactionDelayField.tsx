import { DraftNumberInput } from "../../../components/forms/DraftNumberInput";

const DEFAULT_DELAY_MINUTES = 30;

interface IdleCompactionDelayFieldProps {
  delaySeconds: number | null;
  onChange: (value: number | null) => void;
}

export function IdleCompactionDelayField(props: IdleCompactionDelayFieldProps) {
  const { delaySeconds, onChange } = props;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <strong>Idle compaction delay</strong>
      <p className="muted-text" style={{ marginTop: 0 }}>
        How long a task sits idle before it is compacted. Automatic uses 80% of the model's prompt cache lifetime. A delay longer than the
        cache lifetime means the task is never compacted.
      </p>
      <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={delaySeconds === null}
          onChange={(event) => onChange(event.target.checked ? null : DEFAULT_DELAY_MINUTES * 60)}
        />
        Automatic
      </span>
      {delaySeconds !== null ? (
        <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <DraftNumberInput
            min={1}
            max={1440}
            value={Math.max(1, Math.round(delaySeconds / 60))}
            onValueChange={(minutes) => onChange(minutes * 60)}
            style={{ width: "10rem", padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: "4px" }}
          />
          minutes
        </span>
      ) : null}
    </label>
  );
}
