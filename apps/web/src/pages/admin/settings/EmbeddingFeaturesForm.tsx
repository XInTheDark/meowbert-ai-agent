import type { AdminMemoryEmbeddingSettings, EmbeddingFeatures } from "@meowbert/shared";

interface EmbeddingFeaturesFormProps {
  settings: AdminMemoryEmbeddingSettings;
  disabled: boolean;
  onSave: (input: EmbeddingFeatures) => Promise<boolean>;
}

// Each switch saves as soon as it changes.
export function EmbeddingFeaturesForm({ settings, disabled, onSave }: EmbeddingFeaturesFormProps) {
  const features: EmbeddingFeatures = {
    memorySearchEnabled: settings.memorySearchEnabled,
    historySearchEnabled: settings.historySearchEnabled
  };

  function toggle(key: keyof EmbeddingFeatures, checked: boolean) {
    void onSave({ ...features, [key]: checked });
  }

  return (
    <fieldset className="admin-embeddings-features" disabled={disabled}>
      <legend>Features</legend>
      <label className="task-parameters-toggle">
        <input type="checkbox" checked={features.memorySearchEnabled}
          onChange={(event) => toggle("memorySearchEnabled", event.target.checked)} />
        <span><strong>Memory search</strong><small>Index workspace Memory so agents can search it.</small></span>
      </label>
      <label className="task-parameters-toggle">
        <input type="checkbox" checked={features.historySearchEnabled}
          onChange={(event) => toggle("historySearchEnabled", event.target.checked)} />
        <span><strong>Session history search</strong><small>Index each task's context history so agents can search it by meaning. Embeds tool output too.</small></span>
      </label>
    </fieldset>
  );
}
