import { useState, type FormEvent } from "react";
import { Activity, Cpu, ExternalLink, Plus, Trash2, X } from "lucide-react";
import type {
  AdminAntigravityCredential,
  AntigravityCredentialModelsResult,
  AntigravityCredentialUsageResult
} from "@meowbert/shared";
import { useAdminAntigravity } from "./useAdminAntigravity";

function AntigravityLoginPanel(props: {
  disabled: boolean;
  pendingLogin: { loginSessionId: string; authUrl: string; expiresAt: string } | null;
  onStart: (label?: string) => Promise<boolean>;
  onComplete: (codeOrCallbackUrl: string) => Promise<boolean>;
  onCancel: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [codeInput, setCodeInput] = useState("");

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await props.onStart(label)) {
      setLabel("");
    }
  }

  async function handleComplete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!codeInput.trim()) return;
    if (await props.onComplete(codeInput.trim())) {
      setCodeInput("");
    }
  }

  if (props.pendingLogin) {
    return (
      <form className="stack-form" onSubmit={(event) => void handleComplete(event)}>
        <div className="row-actions">
          <a className="btn secondary" href={props.pendingLogin.authUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Open Google sign-in
          </a>
          <button type="button" className="btn ghost icon-btn" title="Cancel sign-in" aria-label="Cancel sign-in"
            disabled={props.disabled} onClick={() => void props.onCancel()}>
            <X size={16} />
          </button>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <span>Authorization code or callback URL</span>
          <input
            type="text"
            required
            placeholder="Paste the code or full callback URL from Google"
            value={codeInput}
            onChange={(event) => setCodeInput(event.target.value)}
            disabled={props.disabled}
          />
        </label>
        <div className="row-actions">
          <button type="submit" className="btn primary" disabled={props.disabled || !codeInput.trim()}>
            Complete sign-in
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="admin-ai-provider-form" onSubmit={(event) => void handleStart(event)}>
      <label>
        <span>Account label (optional)</span>
        <input
          type="text"
          maxLength={120}
          placeholder="Personal Google"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          disabled={props.disabled}
        />
      </label>
      <button type="submit" className="btn primary" disabled={props.disabled}>
        <Plus size={16} /> Connect Google
      </button>
    </form>
  );
}

function CredentialDetailsPanel(props: {
  models?: AntigravityCredentialModelsResult;
  usage?: AntigravityCredentialUsageResult;
}) {
  if (!props.models && !props.usage) return null;
  return (
    <div className="stack-form" style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
      {props.models ? (
        <div>
          <strong>Models:</strong>{" "}
          {props.models.models.length > 0
            ? props.models.models.map((m) => m.value).join(", ")
            : "None reported"}
          {props.models.thinkingLevels.length > 0 ? (
            <div className="muted-text">
              Thinking levels: {props.models.thinkingLevels.map((t) => t.value).join(", ")}
            </div>
          ) : null}
        </div>
      ) : null}
      {props.usage ? (
        <div>
          <strong>Quota:</strong>{" "}
          {props.usage.groups.length > 0
            ? props.usage.groups.map((g) => g.name).join(", ")
            : "No quota groups reported"}
        </div>
      ) : null}
    </div>
  );
}

function AntigravityCredentialRow(props: {
  credential: AdminAntigravityCredential;
  disabled: boolean;
  models?: AntigravityCredentialModelsResult;
  usage?: AntigravityCredentialUsageResult;
  onSelect: (id: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  onLoadModels: (id: string) => Promise<void>;
  onLoadUsage: (id: string) => Promise<void>;
}) {
  const { credential } = props;
  const subtitleParts = [
    credential.email,
    credential.tierName,
    credential.selected ? "Selected" : null
  ].filter(Boolean);

  return (
    <li className="admin-ai-provider-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <label className="admin-ai-provider-choice">
          <input
            type="radio"
            name="antigravity-credential"
            checked={credential.selected}
            disabled={props.disabled}
            onChange={() => void props.onSelect(credential.id)}
            aria-label={`Use ${credential.label}`}
          />
          <span className="admin-ai-provider-details">
            <span className="admin-ai-provider-url">{credential.label}</span>
            <span className="muted-text">{subtitleParts.join(" · ") || "Personal Google account"}</span>
            {credential.lastError ? <span className="error-text">{credential.lastError}</span> : null}
          </span>
        </label>
        <div className="row-actions">
          <button type="button" className="btn ghost icon-btn" disabled={props.disabled}
            title="Inspect models" aria-label={`Inspect models for ${credential.label}`}
            onClick={() => void props.onLoadModels(credential.id)}>
            <Cpu size={16} />
          </button>
          <button type="button" className="btn ghost icon-btn" disabled={props.disabled}
            title="Check quota" aria-label={`Check quota for ${credential.label}`}
            onClick={() => void props.onLoadUsage(credential.id)}>
            <Activity size={16} />
          </button>
          <button type="button" className="btn ghost icon-btn" disabled={props.disabled}
            title="Remove account" aria-label={`Remove ${credential.label}`}
            onClick={() => void props.onRemove(credential.id)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <CredentialDetailsPanel models={props.models} usage={props.usage} />
    </li>
  );
}

export function AntigravityTab() {
  const state = useAdminAntigravity();
  const disabled = state.isLoading || state.isBusy;

  return (
    <section className="admin-ai-providers" aria-labelledby="antigravity-title">
      <div>
        <h2 id="antigravity-title">Antigravity</h2>
        <p className="muted-text">
          Connect personal Google accounts for worker-managed <code>agy_acp</code> models.
        </p>
      </div>
      {state.isLoading ? <p role="status">Loading accounts…</p> : (
        <>
          {state.credentials.length > 0 ? (
            <ul className="admin-ai-provider-list" aria-label="Antigravity accounts">
              {state.credentials.map((credential) => (
                <AntigravityCredentialRow
                  key={credential.id}
                  credential={credential}
                  disabled={disabled}
                  models={state.modelsById[credential.id]}
                  usage={state.usageById[credential.id]}
                  onSelect={state.selectCredential}
                  onRemove={state.removeCredential}
                  onLoadModels={state.loadModels}
                  onLoadUsage={state.loadUsage}
                />
              ))}
            </ul>
          ) : <p className="muted-text">No Antigravity accounts connected yet.</p>}
          {state.credentials.length > 0 && !state.credentials.some((c) => c.selected)
            ? <p role="status">Select an account to enable Antigravity ACP runs.</p> : null}
        </>
      )}
      <AntigravityLoginPanel
        disabled={disabled}
        pendingLogin={state.pendingLogin}
        onStart={state.startLogin}
        onComplete={state.completeLogin}
        onCancel={state.cancelLogin}
      />
      {state.error ? (
        <div className="row-actions">
          <p className="error-text" role="alert">{state.error}</p>
          <button type="button" className="btn ghost" disabled={disabled} onClick={() => void state.reload()}>
            Reload
          </button>
        </div>
      ) : null}
    </section>
  );
}
