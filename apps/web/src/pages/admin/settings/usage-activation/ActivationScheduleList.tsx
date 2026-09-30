import { Pencil, Trash2 } from "lucide-react";
import type { AdminAiProvider, UsageActivationRule, UsageActivationSchedule } from "@meowbert/shared";
import { weekdayOptions } from "./ActivationRuleEditor";

function formatRule(rule: UsageActivationRule): string {
  const days = rule.days.length === 7 ? "Every day" : weekdayOptions.filter((day) => rule.days.includes(day.value)).map((day) => day.label).join(", ");
  return rule.kind === "at" ? `${days} at ${rule.time}`
    : `${days}, every ${rule.everyMinutes} min · ${rule.windows.map((window) => `${window.start}–${window.end}`).join(", ")}`;
}
function utc(value: string | null): string {
  return value ? new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
}

export function ActivationScheduleList({ schedules, providers, disabled, onEdit, onRemove, onToggle }: {
  schedules: UsageActivationSchedule[]; providers: AdminAiProvider[]; disabled: boolean;
  onEdit: (schedule: UsageActivationSchedule) => void; onRemove: (id: string) => void;
  onToggle: (schedule: UsageActivationSchedule) => void;
}) {
  return <ul className="activation-list" aria-label="Activation schedules">
    {schedules.map((schedule) => (
      <li key={schedule.id} className="activation-schedule">
        <div className="activation-schedule-head">
          <label className="activation-enabled"><input type="checkbox" checked={schedule.enabled} disabled={disabled || !schedule.providerId}
            aria-label={`Enable ${schedule.name}`} onChange={() => onToggle(schedule)} /><strong>{schedule.name}</strong></label>
          <div className="row-actions">
            <button type="button" className="btn ghost icon-btn" disabled={disabled} aria-label={`Edit ${schedule.name}`}
              onClick={() => onEdit(schedule)}><Pencil size={16} /></button>
            <button type="button" className="btn ghost icon-btn" disabled={disabled} aria-label={`Delete ${schedule.name}`}
              onClick={() => onRemove(schedule.id)}><Trash2 size={16} /></button>
          </div>
        </div>
        <p className="activation-target">{schedule.model} · {providers.find((provider) => provider.id === schedule.providerId)?.baseUrl ?? "Provider removed — edit this schedule"}</p>
        {schedule.rules.map((rule, index) => <p className="muted-text" key={index}>{formatRule(rule)} UTC</p>)}
        <div className="activation-results muted-text">
          <span>Next: {schedule.enabled && schedule.providerId ? utc(schedule.nextRunAt) : "Paused"}</span>
          <span>Last: {schedule.lastStatus ?? "Never run"}{schedule.lastRunAt ? ` · ${utc(schedule.lastRunAt)}` : ""}</span>
        </div>
        {schedule.lastError ? <p className={schedule.lastStatus === "failed" ? "error-text" : "muted-text"}>{schedule.lastError}</p> : null}
      </li>
    ))}
  </ul>;
}
