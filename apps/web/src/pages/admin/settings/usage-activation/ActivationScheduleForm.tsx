import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type { AdminAiProvider, UsageActivationInput, UsageActivationSchedule } from "@meowbert/shared";
import { ActivationRuleEditor, newActivationRule } from "./ActivationRuleEditor";

export function ActivationScheduleForm({ schedule, providers, models, saving, onSave, onCancel }: {
  schedule?: UsageActivationSchedule; providers: AdminAiProvider[]; models: string[]; saving: boolean;
  onSave: (input: UsageActivationInput, id?: string) => Promise<boolean>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<UsageActivationInput>(() => ({
    name: schedule?.name ?? "", model: schedule?.model ?? "", enabled: schedule?.enabled ?? false,
    providerId: schedule?.providerId ?? providers.find((provider) => provider.selected)?.id ?? providers[0]?.id ?? "",
    rules: schedule?.rules ?? [newActivationRule()]
  }));
  const [validation, setValidation] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.rules.some((rule) => rule.days.length === 0)) { setValidation("Choose at least one weekday for each rule."); return; }
    if (draft.rules.some((rule) => rule.kind === "interval" && rule.windows.some((window) => window.start === window.end))) {
      setValidation("Window start and end must differ. Use 00:00 to 00:00 for a full day."); return;
    }
    setValidation(null);
    if (await onSave({ ...draft, name: draft.name.trim(), model: draft.model.trim() }, schedule?.id)) onCancel();
  }
  return (
    <form className="activation-form" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={saving} className="activation-form-fields">
        <legend>{schedule ? "Edit schedule" : "New schedule"}</legend>
        <div className="activation-fields">
          <label>Name<input required maxLength={120} value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Provider<select required value={draft.providerId} onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}>
            <option value="" disabled>Choose a provider</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.baseUrl}</option>)}
          </select></label>
          <label>Model ID<input required maxLength={240} list="activation-models" value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
          <datalist id="activation-models">{models.map((model) => <option key={model} value={model} />)}</datalist>
        </div>
        <label className="activation-enabled"><input type="checkbox" checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Enabled</label>
        {draft.rules.map((rule, index) => (
          <ActivationRuleEditor key={index} rule={rule} index={index} removable={draft.rules.length > 1}
            onChange={(replacement) => setDraft({ ...draft, rules: draft.rules.map((item, i) => i === index ? replacement : item) })}
            onRemove={() => setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })} />
        ))}
        <button type="button" className="btn ghost" disabled={draft.rules.length >= 20}
          onClick={() => setDraft({ ...draft, rules: [...draft.rules, newActivationRule()] })}><Plus size={14} /> Rule</button>
        {validation ? <p className="error-text" role="alert">{validation}</p> : null}
        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={!providers.length}>{saving ? "Saving…" : "Save schedule"}</button>
          <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}
