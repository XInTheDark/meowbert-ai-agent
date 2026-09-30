import { FormEvent, useState } from "react";
import type { AiProviderConfig } from "@meowbert/shared";
import type { ApiClient } from "../../lib/api";

export function AdminSetupProviderStep(props: {
  api: ApiClient;
  initialProvider: AiProviderConfig | null;
  onConnected: (provider: AiProviderConfig, models: string[]) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(props.initialProvider?.baseUrl ?? "https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState(props.initialProvider?.apiKey ?? "");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(event: FormEvent): Promise<void> {
    event.preventDefault();
    const provider = { baseUrl: baseUrl.trim(), apiKey: apiKey.trim() };
    setIsConnecting(true);
    setError(null);
    try {
      const response = await props.api.post<{ models: string[] }>("/api/admin/ai-providers/models", provider);
      props.onConnected(provider, response.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <form className="stack-form" onSubmit={(event) => void connect(event)}>
      <p className="muted-text" style={{ margin: 0 }}>
        Meowbert works with any provider that supports the OpenAI Responses API, such as OpenAI, a gateway, or a local server.
      </p>
      <label>
        Base URL
        <input type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" />
      </label>
      <label>
        API key
        <input type="password" required autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
      </label>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="row-actions">
        <button className="btn primary" type="submit" disabled={isConnecting}>
          {isConnecting ? "Connecting…" : "Connect"}
        </button>
        {error ? (
          <button className="btn ghost" type="button" onClick={() => props.onConnected({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }, [])}>
            Enter models manually
          </button>
        ) : null}
      </div>
    </form>
  );
}
