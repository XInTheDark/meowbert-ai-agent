import { Plus, Trash2 } from "lucide-react";
import type { UsageActivationRule } from "@meowbert/shared";

export const weekdayOptions = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" },
  { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" }
];

export function newActivationRule(): UsageActivationRule {
  return { kind: "at", days: [1, 2, 3, 4, 5, 6, 0], time: "03:00" };
}

function IntervalWindows({ rule, onChange }: {
  rule: Extract<UsageActivationRule, { kind: "interval" }>;
  onChange: (rule: UsageActivationRule) => void;
}) {
  function update(index: number, key: "start" | "end", value: string) {
    onChange({ ...rule, windows: rule.windows.map((window, i) => i === index ? { ...window, [key]: value } : window) });
  }
  return (
    <div className="activation-windows">
      <label>Every (minutes)<input type="number" min={1} max={1440} required value={rule.everyMinutes || ""}
        onChange={(event) => onChange({ ...rule, everyMinutes: Number(event.target.value) })} /></label>
      {rule.windows.map((window, index) => (
        <div className="activation-window" key={index}>
          <label>From<input type="time" required value={window.start} onChange={(event) => update(index, "start", event.target.value)} /></label>
          <label>Until<input type="time" required value={window.end === "24:00" ? "00:00" : window.end}
            onChange={(event) => update(index, "end", event.target.value === "00:00" ? "24:00" : event.target.value)} /></label>
          <button type="button" className="btn ghost icon-btn" aria-label={`Remove window ${index + 1}`}
            disabled={rule.windows.length === 1}
            onClick={() => onChange({ ...rule, windows: rule.windows.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost" disabled={rule.windows.length >= 12}
        onClick={() => onChange({ ...rule, windows: [...rule.windows, { start: "18:00", end: "22:00" }] })}>
        <Plus size={14} /> Window
      </button>
      <p className="muted-text activation-help">Starts at each window’s beginning; excludes the end. An earlier end continues into the next day.</p>
    </div>
  );
}

export function ActivationRuleEditor({ rule, index, removable, onChange, onRemove }: {
  rule: UsageActivationRule; index: number; removable: boolean;
  onChange: (rule: UsageActivationRule) => void; onRemove: () => void;
}) {
  return (
    <fieldset className="activation-rule">
      <legend>Rule {index + 1} · UTC</legend>
      <div className="activation-rule-head">
        <label>Frequency<select value={rule.kind} onChange={(event) => onChange(event.target.value === "at"
          ? { kind: "at", days: rule.days, time: "03:00" }
          : { kind: "interval", days: rule.days, everyMinutes: 60, windows: [{ start: "00:00", end: "24:00" }] })}>
          <option value="at">At a time</option><option value="interval">Every interval</option>
        </select></label>
        <button type="button" className="btn ghost icon-btn" aria-label={`Remove rule ${index + 1}`}
          disabled={!removable} onClick={onRemove}><Trash2 size={16} /></button>
      </div>
      <div className="activation-days" role="group" aria-label={`Days for rule ${index + 1}`}>
        {weekdayOptions.map((day) => (
          <label key={day.value} className={rule.days.includes(day.value) ? "selected" : ""}>
            <input type="checkbox" checked={rule.days.includes(day.value)} onChange={(event) => onChange({ ...rule,
              days: event.target.checked ? [...rule.days, day.value] : rule.days.filter((value) => value !== day.value) })} />
            {day.label}
          </label>
        ))}
      </div>
      {rule.kind === "at" ? <label className="activation-time">Time (UTC)<input type="time" required value={rule.time}
        onChange={(event) => onChange({ ...rule, time: event.target.value })} /></label>
        : <IntervalWindows rule={rule} onChange={onChange} />}
    </fieldset>
  );
}
