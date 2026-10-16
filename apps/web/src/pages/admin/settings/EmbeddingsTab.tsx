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
      <MemoryReindexPanel job={state.job} disabled={disabled} onStart={state.startReindex} onCancel={state.cancelReindex} />
      {state.error ? (
        <div className="row-actions">
          <p className="error-text" role="alert">{state.error}</p>
          <button type="button" className="btn ghost" disabled={disabled} onClick={() => void state.reload()}>Reload</button>
        </div>
      ) : null}
    </section>
  );
}
