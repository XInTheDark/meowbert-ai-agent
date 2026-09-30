import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import type { AdminSourcesResponse } from "./shared";
import type { AdminSourceProviderSettings, SourceProvider } from "../../../sources/sourceTypes";

interface SourceProviderDraft {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

function buildSourceProviderDraft(source: AdminSourceProviderSettings): SourceProviderDraft {
  return {
    enabled: source.enabled,
    clientId: source.clientId ?? "",
    clientSecret: source.clientSecret ?? ""
  };
}

type SourceCredentialField = "clientId" | "clientSecret";

interface SourceCredentialVisibility {
  clientId: boolean;
  clientSecret: boolean;
}

function buildCredentialVisibility(): SourceCredentialVisibility {
  return {
    clientId: false,
    clientSecret: false
  };
}

function SourceCredentialInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  isRevealed: boolean;
  onToggleVisibility: () => void;
}): JSX.Element {
  return (
    <label>
      <strong>{props.label}</strong>
      <div className="admin-credential-input-row">
        <input
          type={props.isRevealed ? "text" : "password"}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
          autoComplete="off"
        />
        <button
          className="btn ghost admin-credential-toggle"
          type="button"
          onClick={props.onToggleVisibility}
          aria-label={props.isRevealed ? `Hide ${props.label}` : `Show ${props.label}`}
          aria-pressed={props.isRevealed}
          title={props.isRevealed ? `Hide ${props.label}` : `Show ${props.label}`}
        >
          {props.isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
          <span>{props.isRevealed ? "Hide" : "View"}</span>
        </button>
      </div>
    </label>
  );
}

export function SourcesSettingsTab() {
  const { api, setFlash } = useWorkspaceApp();
  const [sources, setSources] = useState<AdminSourceProviderSettings[]>([]);
  const [draftsByProvider, setDraftsByProvider] = useState<Partial<Record<SourceProvider, SourceProviderDraft>>>({});
  const [credentialVisibilityByProvider, setCredentialVisibilityByProvider] = useState<
    Partial<Record<SourceProvider, SourceCredentialVisibility>>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<SourceProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<AdminSourcesResponse>("/api/admin/sources");
      setSources(response.sources);
      setDraftsByProvider((current) => response.sources.reduce<Partial<Record<SourceProvider, SourceProviderDraft>>>(
        (acc, source) => ({
          ...acc,
          [source.provider]: buildSourceProviderDraft(source)
        }),
        current
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setSources([]);
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  function updateDraft(provider: SourceProvider, updater: (draft: SourceProviderDraft) => SourceProviderDraft): void {
    setDraftsByProvider((current) => ({
      ...current,
      [provider]: updater(current[provider] ?? {
        enabled: false,
        clientId: "",
        clientSecret: ""
      })
    }));
  }

  function toggleCredentialVisibility(provider: SourceProvider, field: SourceCredentialField): void {
    setCredentialVisibilityByProvider((current) => {
      const providerVisibility = current[provider] ?? buildCredentialVisibility();
      return {
        ...current,
        [provider]: {
          ...providerVisibility,
          [field]: !providerVisibility[field]
        }
      };
    });
  }

  async function saveSourceProvider(source: AdminSourceProviderSettings, event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const draft = draftsByProvider[source.provider];
    if (!draft) {
      return;
    }

    setSavingProvider(source.provider);
    setError(null);
    try {
      const trimmedClientId = draft.clientId.trim();
      const trimmedClientSecret = draft.clientSecret.trim();
      const response = await api.patch<{ source: AdminSourceProviderSettings }>(
        `/api/admin/sources/${source.provider}`,
        {
          enabled: draft.enabled,
          ...(source.requiresAdminCredentials && trimmedClientId.length > 0 ? { clientId: trimmedClientId } : {}),
          ...(source.requiresAdminCredentials && trimmedClientSecret.length > 0 ? { clientSecret: trimmedClientSecret } : {})
        }
      );

      setSources((current) => {
        const next = current.filter((entry) => entry.provider !== source.provider);
        next.push(response.source);
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      setDraftsByProvider((current) => ({
        ...current,
        [source.provider]: buildSourceProviderDraft(response.source)
      }));
      setFlash({ tone: "success", text: `${source.name} settings saved.` });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingProvider(null);
    }
  }

  if (isLoading) {
    return <div className="muted-text" style={{ marginTop: "1rem" }}>Loading sources…</div>;
  }

  return (
    <div className="stack-form" style={{ marginTop: "1rem" }}>
      {sources.map((source) => {
        const draft = draftsByProvider[source.provider] ?? buildSourceProviderDraft(source);
        const credentialVisibility = credentialVisibilityByProvider[source.provider] ?? buildCredentialVisibility();
        const isSaving = savingProvider === source.provider;

        return (
          <form
            key={source.provider}
            className="section-card"
            style={{ boxShadow: "none", background: "var(--surface-muted)" }}
            onSubmit={(event) => {
              void saveSourceProvider(source, event);
            }}
          >
            <div className="section-head" style={{ marginBottom: "0.65rem" }}>
              <div>
                <strong>{source.name}</strong>
                <p className="hint-text" style={{ margin: "0.25rem 0 0" }}>
                  {source.requiresAdminCredentials
                    ? "OAuth app credentials for workspace Sources."
                    : "This source only needs to be enabled. No OAuth credentials are required."}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
              <span className={`badge ${source.enabled ? "success" : "muted"}`}>
                {source.enabled ? "Enabled" : "Disabled"}
              </span>
              {source.requiresAdminCredentials ? (
                <>
                  <span className={`badge ${source.hasClientId ? "success" : "muted"}`}>
                    {source.hasClientId ? "Client ID saved" : "No client ID"}
                  </span>
                  <span className={`badge ${source.hasClientSecret ? "success" : "muted"}`}>
                    {source.hasClientSecret ? "Client secret saved" : "No client secret"}
                  </span>
                </>
              ) : (
                <span className="badge success">No credentials required</span>
              )}
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => updateDraft(source.provider, (current) => ({
                  ...current,
                  enabled: event.target.checked
                }))}
                style={{ width: "1rem", height: "1rem" }}
              />
              <span>Enable {source.name}</span>
            </label>

            {source.requiresAdminCredentials ? (
              <>
                <SourceCredentialInput
                  label="Client ID"
                  value={draft.clientId}
                  onChange={(value) => updateDraft(source.provider, (current) => ({
                    ...current,
                    clientId: value
                  }))}
                  placeholder="Paste OAuth client ID"
                  isRevealed={credentialVisibility.clientId}
                  onToggleVisibility={() => toggleCredentialVisibility(source.provider, "clientId")}
                />

                <SourceCredentialInput
                  label="Client secret"
                  value={draft.clientSecret}
                  onChange={(value) => updateDraft(source.provider, (current) => ({
                    ...current,
                    clientSecret: value
                  }))}
                  placeholder="Paste OAuth client secret"
                  isRevealed={credentialVisibility.clientSecret}
                  onToggleVisibility={() => toggleCredentialVisibility(source.provider, "clientSecret")}
                />
              </>
            ) : null}

            <div className="row-actions">
              <button className="btn primary" type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : `Save ${source.name}`}
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={isSaving}
                onClick={() => {
                  updateDraft(source.provider, () => buildSourceProviderDraft(source));
                  setError(null);
                }}
              >
                Reset
              </button>
            </div>
          </form>
        );
      })}

      {sources.length === 0 ? <p className="muted-text">No sources are installed on this server yet.</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
