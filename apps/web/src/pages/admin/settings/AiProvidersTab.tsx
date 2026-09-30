import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AiProviderConfig } from "@meowbert/shared";
import { useAdminAiProviders } from "./useAdminAiProviders";

function AddAiProviderForm(props: {
  disabled: boolean;
  onAdd: (provider: AiProviderConfig) => Promise<boolean>;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await props.onAdd({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() })) {
      setBaseUrl("");
      setApiKey("");
    }
  }

  return (
    <form className="admin-ai-provider-form" onSubmit={(event) => void submit(event)}>
      <label>
        <span>Base URL</span>
        <input type="url" required maxLength={2048} placeholder="https://api.openai.com/v1"
          value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={props.disabled} />
      </label>
      <label>
        <span>API key</span>
        <input type="password" required maxLength={4096} autoComplete="new-password"
          value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={props.disabled} />
      </label>
      <button type="submit" className="btn primary" disabled={props.disabled || !baseUrl.trim() || !apiKey.trim()}>
        <Plus size={16} /> Add
      </button>
    </form>
  );
}

export function AiProvidersTab() {
  const state = useAdminAiProviders();
  const disabled = state.isLoading || state.isSaving;

  return (
    <section className="admin-ai-providers" aria-labelledby="ai-providers-title">
      <div>
        <h2 id="ai-providers-title">AI providers</h2>
        <p className="muted-text">Select the provider for new platform AI runs.</p>
      </div>
      {state.isLoading ? <p role="status">Loading providers…</p> : (
        <>
          {state.providers.length > 0 ? (
            <ul className="admin-ai-provider-list" aria-label="AI providers">
              {state.providers.map((provider) => (
                <li key={provider.id} className="admin-ai-provider-row">
                  <label className="admin-ai-provider-choice">
                    <input type="radio" name="ai-provider" checked={provider.selected} disabled={disabled}
                      onChange={() => void state.selectProvider(provider.id)} aria-label={`Use ${provider.baseUrl}`} />
                    <span className="admin-ai-provider-details">
                      <span className="admin-ai-provider-url">{provider.baseUrl}</span>
                      <span className="muted-text">API key: ••••••••{provider.selected ? " · Selected" : ""}</span>
                    </span>
                  </label>
                  <button type="button" className="btn ghost icon-btn" disabled={disabled}
                    aria-label={`Remove ${provider.baseUrl}`} title="Remove provider"
                    onClick={() => void state.removeProvider(provider.id)}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="muted-text">No providers yet. Add one to get started.</p>}
          {state.providers.length > 0 && !state.providers.some((provider) => provider.selected)
            ? <p role="status">Select a provider to enable platform AI runs.</p> : null}
        </>
      )}
      <AddAiProviderForm disabled={disabled} onAdd={state.addProvider} />
      {state.error ? (
        <div className="row-actions">
          <p className="error-text" role="alert">{state.error}</p>
          <button type="button" className="btn ghost" disabled={disabled} onClick={() => void state.reload()}>Reload</button>
        </div>
      ) : null}
    </section>
  );
}
