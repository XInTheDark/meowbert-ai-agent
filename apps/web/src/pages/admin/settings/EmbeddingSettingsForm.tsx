import { useEffect, useState, type FormEvent } from "react";
import type { AdminAiProvider, AdminMemoryEmbeddingSettings, MemoryEmbeddingSettingsInput } from "@meowbert/shared";

interface EmbeddingSettingsFormProps {
  settings: AdminMemoryEmbeddingSettings;
  providers: AdminAiProvider[];
  disabled: boolean;
  onSave: (input: MemoryEmbeddingSettingsInput) => Promise<boolean>;
}

const FOLLOW_SELECTED_PROVIDER = "";

export function EmbeddingSettingsForm({ settings, providers, disabled, onSave }: EmbeddingSettingsFormProps) {
  const [providerId, setProviderId] = useState(settings.providerId ?? FOLLOW_SELECTED_PROVIDER);
  const [model, setModel] = useState(settings.model);
  const [documentTemplate, setDocumentTemplate] = useState(settings.documentTemplate ?? "");
  const [queryTemplate, setQueryTemplate] = useState(settings.queryTemplate ?? "");

  useEffect(() => {
    setProviderId(settings.providerId ?? FOLLOW_SELECTED_PROVIDER);
    setModel(settings.model);
    setDocumentTemplate(settings.documentTemplate ?? "");
    setQueryTemplate(settings.queryTemplate ?? "");
  }, [settings]);

  const selectedProvider = providers.find((provider) => provider.selected);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave({
      providerId: providerId || null,
      model: model.trim(),
      documentTemplate: documentTemplate.trim() || null,
      queryTemplate: queryTemplate.trim() || null
    });
  }

  return (
    <form className="admin-embeddings-form" onSubmit={submit}>
      <label>
        <span>Provider</span>
        <select value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={disabled}>
          <option value={FOLLOW_SELECTED_PROVIDER}>
            Selected AI provider{selectedProvider ? ` (${selectedProvider.baseUrl})` : ""}
          </option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.baseUrl}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Model</span>
        <input required maxLength={200} placeholder="text-embedding-3-small" value={model}
          onChange={(event) => setModel(event.target.value)} disabled={disabled} />
      </label>
      <details className="admin-embeddings-advanced">
        <summary>Prompt templates</summary>
        <p className="muted-text">Only for models that expect a prefix. Use {"{text}"} where the content goes.</p>
        <label>
          <span>Document template</span>
          <input maxLength={2000} placeholder="search_document: {text}" value={documentTemplate}
            onChange={(event) => setDocumentTemplate(event.target.value)} disabled={disabled} />
        </label>
        <label>
          <span>Query template</span>
          <input maxLength={2000} placeholder="search_query: {text}" value={queryTemplate}
            onChange={(event) => setQueryTemplate(event.target.value)} disabled={disabled} />
        </label>
      </details>
      <p className="muted-text">Saving never re-embeds Memory. After changing the model or templates, re-embed below to apply them.</p>
      <div>
        <button type="submit" className="btn primary" disabled={disabled || !model.trim()}>Save</button>
      </div>
    </form>
  );
}
