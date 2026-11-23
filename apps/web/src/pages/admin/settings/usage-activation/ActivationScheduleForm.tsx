import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type {
  AdminAiProvider,
  AdminAntigravityCredential,
  UsageActivationInput,
  UsageActivationSchedule
} from "@meowbert/shared";
import { ActivationRuleEditor, newActivationRule } from "./ActivationRuleEditor";

const ANTIGRAVITY_PROVIDER_VALUE = "__antigravity__";

function AntigravityCredentialCheckboxes(props: {
  credentials: AdminAntigravityCredential[];
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
}) {
  if (props.credentials.length === 0) {
    return <p className="muted-text">Connect at least one account in Admin → Antigravity first.</p>;
  }
  function toggle(id: string) {
    const exists = props.selectedIds.includes(id);
    props.onChange(exists ? props.selectedIds.filter((entry) => entry !== id) : [...props.selectedIds, id]);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <span style={{ fontWeight: 500 }}>Antigravity accounts</span>
      {props.credentials.map((cred) => (
        <label key={cred.id} className="activation-enabled">
          <input
            type="checkbox"
            checked={props.selectedIds.includes(cred.id)}
            onChange={() => toggle(cred.id)}
          />
          <span>{cred.label}{cred.email ? ` (${cred.email})` : ""}</span>
        </label>
      ))}
    </div>
  );
}

export function ActivationScheduleForm({
  schedule, providers, antigravityCredentials = [], models, saving, onSave, onCancel
}: {
  schedule?: UsageActivationSchedule;
  providers: AdminAiProvider[];
  antigravityCredentials?: AdminAntigravityCredential[];
  models: string[];
  saving: boolean;
  onSave: (input: UsageActivationInput, id?: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const defaultIsAntigravity = schedule
    ? schedule.targetType === "antigravity"
    : providers.length === 0 && antigravityCredentials.length > 0;
  const [draft, setDraft] = useState<UsageActivationInput>(() => ({
    name: schedule?.name ?? "",
    targetType: defaultIsAntigravity ? "antigravity" : "ai_provider",
    providerId: defaultIsAntigravity
      ? null
      : (schedule?.providerId ?? providers.find((provider) => provider.selected)?.id ?? providers[0]?.id ?? ""),
    antigravityCredentialIds: schedule?.antigravityCredentialIds
      ?? (defaultIsAntigravity ? antigravityCredentials.filter((c) => c.selected).map((c) => c.id) : []),
    model: schedule?.model ?? "",
    enabled: schedule?.enabled ?? false,
    rules: schedule?.rules ?? [newActivationRule()]
  }));
  const [validation, setValidation] = useState<string | null>(null);

  const isAntigravity = draft.targetType === "antigravity";
  const selectedProviderValue = isAntigravity ? ANTIGRAVITY_PROVIDER_VALUE : (draft.providerId ?? "");
  const hasAnyTarget = providers.length > 0 || antigravityCredentials.length > 0;

  function handleProviderSelect(value: string) {
    if (value === ANTIGRAVITY_PROVIDER_VALUE) {
      const existingIds = draft.antigravityCredentialIds ?? [];
      const fallbackIds = existingIds.length > 0
        ? existingIds
        : antigravityCredentials.filter((c) => c.selected).map((c) => c.id);
      setDraft({ ...draft, targetType: "antigravity", providerId: null, antigravityCredentialIds: fallbackIds });
      return;
    }
    setDraft({ ...draft, targetType: "ai_provider", providerId: value, antigravityCredentialIds: [] });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isAntigravity && (draft.antigravityCredentialIds?.length ?? 0) === 0) {
      setValidation("Select at least one Antigravity account.");
      return;
    }
    if (draft.rules.some((rule) => rule.days.length === 0)) {
      setValidation("Choose at least one weekday for each rule.");
      return;
    }
    if (draft.rules.some((rule) => rule.kind === "interval" && rule.windows.some((window) => window.start === window.end))) {
      setValidation("Window start and end must differ. Use 00:00 to 00:00 for a full day.");
      return;
    }
    setValidation(null);
    const payload: UsageActivationInput = isAntigravity
      ? {
          name: draft.name.trim(),
          targetType: "antigravity",
          providerId: null,
          antigravityCredentialIds: draft.antigravityCredentialIds ?? [],
          model: draft.model.trim(),
          enabled: draft.enabled,
          rules: draft.rules
        }
      : {
          name: draft.name.trim(),
          targetType: "ai_provider",
          providerId: draft.providerId ?? null,
          antigravityCredentialIds: [],
          model: draft.model.trim(),
          enabled: draft.enabled,
          rules: draft.rules
        };
    if (await onSave(payload, schedule?.id)) onCancel();
  }

  return (
    <form className="activation-form" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={saving} className="activation-form-fields">
        <legend>{schedule ? "Edit schedule" : "New schedule"}</legend>
        <div className="activation-fields">
          <label>Name<input required maxLength={120} value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Provider<select required value={selectedProviderValue} onChange={(event) => handleProviderSelect(event.target.value)}>
            <option value="" disabled>Choose a provider</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.baseUrl}</option>)}
            {antigravityCredentials.length > 0 || isAntigravity
              ? <option value={ANTIGRAVITY_PROVIDER_VALUE}>Antigravity (ACP)</option>
              : null}
          </select></label>
          <label>Model ID<input required maxLength={240} list="activation-models" value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
          <datalist id="activation-models">{models.map((model) => <option key={model} value={model} />)}</datalist>
        </div>
        {isAntigravity ? (
          <AntigravityCredentialCheckboxes
            credentials={antigravityCredentials}
            selectedIds={draft.antigravityCredentialIds ?? []}
            onChange={(nextIds) => setDraft({ ...draft, antigravityCredentialIds: nextIds })}
          />
        ) : null}
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
          <button className="btn primary" type="submit" disabled={!hasAnyTarget}>{saving ? "Saving…" : "Save schedule"}</button>
          <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}
