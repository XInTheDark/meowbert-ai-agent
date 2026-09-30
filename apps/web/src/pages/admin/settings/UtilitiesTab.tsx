import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { UsageActivationSchedule } from "@meowbert/shared";
import { useUsageActivation } from "./usage-activation/useUsageActivation";
import { ActivationScheduleForm } from "./usage-activation/ActivationScheduleForm";
import { ActivationScheduleList } from "./usage-activation/ActivationScheduleList";
import "./usage-activation/usage-activation.css";

export function UtilitiesTab({ models = [] }: { models?: string[] }) {
  const state = useUsageActivation();
  const [editing, setEditing] = useState<UsageActivationSchedule | "new" | null>(null);
  async function toggle(schedule: UsageActivationSchedule) {
    if (!schedule.providerId) return;
    await state.save({ name: schedule.name, model: schedule.model, providerId: schedule.providerId,
      enabled: !schedule.enabled, rules: schedule.rules }, schedule.id);
  }
  return (
    <section className="admin-utilities" aria-labelledby="usage-activation-title">
      <div className="activation-heading">
        <h2 id="usage-activation-title">Scheduled usage activation</h2>
        <div className="row-actions">
          <button type="button" className="btn ghost icon-btn" aria-label="Refresh schedules"
            disabled={state.loading || state.saving || editing !== null} onClick={() => void state.reload()}><RefreshCw size={16} /></button>
          <button type="button" className="btn primary" disabled={state.loading || state.saving || editing !== null || state.schedules.length >= 100}
            onClick={() => setEditing("new")}><Plus size={16} /> Schedule</button>
        </div>
      </div>
      <p className="muted-text">Send a small request to a provider and model at scheduled times. All times are UTC; requests consume provider usage.</p>
      <p className="muted-text activation-help">Missed times are skipped after one minute. Failed requests aren’t retried. Provider rules determine whether a request starts a usage window.</p>
      {state.loading ? <p role="status">Loading schedules…</p> : <>
        {!state.providers.length ? <p role="status">Add a provider in AI providers first.</p> : null}
        {!state.schedules.length && !editing ? <p className="muted-text">No schedules yet.</p> : null}
        <ActivationScheduleList schedules={state.schedules} providers={state.providers} disabled={state.saving || editing !== null}
          onEdit={setEditing} onRemove={(id) => void state.remove(id)} onToggle={(schedule) => void toggle(schedule)} />
        {editing ? <ActivationScheduleForm key={editing === "new" ? "new" : editing.id}
          schedule={editing === "new" ? undefined : editing} providers={state.providers} models={models}
          saving={state.saving} onSave={state.save} onCancel={() => setEditing(null)} /> : null}
      </>}
      {state.error ? <p role="alert" className="error-text">{state.error}</p> : null}
    </section>
  );
}
