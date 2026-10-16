import { EmbeddingSettingsForm } from "./EmbeddingSettingsForm";
import { MemoryReindexPanel } from "./MemoryReindexPanel";
import { useAdminMemoryEmbeddings } from "./useAdminMemoryEmbeddings";

export function EmbeddingsTab() {
  const state = useAdminMemoryEmbeddings();
  const disabled = state.isLoading || state.isSaving;

  return (
    <section className="admin-embeddings" aria-labelledby="embeddings-title">
      <div>
        <h2 id="embeddings-title">Embeddings</h2>
        <p className="muted-text">The model used to index and search workspace Memory.</p>
      </div>
      {state.isLoading && !state.settings ? <p role="status">Loading embedding settings…</p> : null}
      {state.settings ? (
        <EmbeddingSettingsForm settings={state.settings} providers={state.providers} disabled={disabled} onSave={state.saveSettings} />
      ) : null}
      {state.settings?.indexOutdated ? (
        <p className="admin-embeddings-outdated" role="status">
          Memory indexes were built with {state.settings.indexedModel ?? "different settings"}
          {state.settings.indexedModel === state.settings.model ? " and different templates" : ""}.
          Search quality is reduced until you re-embed.
        </p>
      ) : null}
      <MemoryReindexPanel
        job={state.job}
        disabled={disabled}
        onReembedLazily={state.reembedLazily}
        onStart={state.startReindex}
        onCancel={state.cancelReindex}
      />
      {state.error ? (
        <div className="row-actions">
          <p className="error-text" role="alert">{state.error}</p>
          <button type="button" className="btn ghost" disabled={disabled} onClick={() => void state.reload()}>Reload</button>
        </div>
      ) : null}
    </section>
  );
}
