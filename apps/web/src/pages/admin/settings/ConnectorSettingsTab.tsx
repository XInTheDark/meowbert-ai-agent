import type { FormEvent } from "react";
import { formatDebugDetails, type EmailInboundDebugEvent, type SharedConnectorStatusResponse } from "./shared";

interface ConnectorSettingsTabProps {
  sharedConnectors: SharedConnectorStatusResponse["connectors"] | null;
  sharedDiscordEnabledDraft: boolean;
  sharedDiscordTokenDraft: string;
  sharedTelegramEnabledDraft: boolean;
  sharedTelegramTokenDraft: string;
  sharedTelegramIngestModeDraft: "webhook" | "polling";
  listmonkEnabledDraft: boolean;
  listmonkBaseUrlDraft: string;
  listmonkApiUsernameDraft: string;
  listmonkApiTokenDraft: string;
  emailInboundEnabledDraft: boolean;
  emailInboundDomainDraft: string;
  emailInboundAddressModeDraft: "random" | "workspace_custom";
  emailInboundDebugLoggingEnabledDraft: boolean;
  emailInboundWebhookSecretDraft: string;
  emailInboundBrevoApiKeyDraft: string;
  emailInboundWebhookEndpoint: string | null;
  syncedBrevoWebhookUrl: string | null;
  emailInboundWebhookEndpointPlaceholder: string;
  hasPendingEmailInboundSecretEdits: boolean;
  canSyncBrevoInboundWebhook: boolean;
  emailInboundDebugEvents: EmailInboundDebugEvent[];
  isSaving: boolean;
  isSyncingBrevoWebhook: boolean;
  isRefreshingEmailInboundDebugEvents: boolean;
  error: string | null;
  onSharedDiscordEnabledDraftChange: (value: boolean) => void;
  onSharedDiscordTokenDraftChange: (value: string) => void;
  onSharedTelegramEnabledDraftChange: (value: boolean) => void;
  onSharedTelegramTokenDraftChange: (value: string) => void;
  onSharedTelegramIngestModeDraftChange: (value: "webhook" | "polling") => void;
  onListmonkEnabledDraftChange: (value: boolean) => void;
  onListmonkBaseUrlDraftChange: (value: string) => void;
  onListmonkApiUsernameDraftChange: (value: string) => void;
  onListmonkApiTokenDraftChange: (value: string) => void;
  onEmailInboundEnabledDraftChange: (value: boolean) => void;
  onEmailInboundDomainDraftChange: (value: string) => void;
  onEmailInboundAddressModeDraftChange: (value: "random" | "workspace_custom") => void;
  onEmailInboundDebugLoggingEnabledDraftChange: (value: boolean) => void;
  onEmailInboundWebhookSecretDraftChange: (value: string) => void;
  onEmailInboundBrevoApiKeyDraftChange: (value: string) => void;
  onSaveSharedDiscordSettings: (event: FormEvent) => Promise<void>;
  onSaveSharedTelegramSettings: (event: FormEvent) => Promise<void>;
  onSaveSharedListmonkSettings: (event: FormEvent) => Promise<void>;
  onSaveSharedEmailInboundSettings: (event: FormEvent) => Promise<void>;
  onSyncBrevoInboundWebhook: () => Promise<void>;
  onCopyGeneratedEmailWebhookUrl: () => Promise<void>;
  onReloadEmailInboundDebugEvents: () => Promise<void>;
}

export function ConnectorSettingsTab(props: ConnectorSettingsTabProps) {
  return (
    <div className="stack-form" style={{ marginTop: "1rem" }}>
      <form className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }} onSubmit={(event) => void props.onSaveSharedDiscordSettings(event)}>
        <div className="section-head" style={{ marginBottom: "0.65rem" }}>
          <div>
            <strong>Shared Discord bot</strong>
            <p className="hint-text" style={{ margin: "0.25rem 0 0" }}>
              {props.sharedConnectors?.discord.hasToken ? "Token is configured." : "No token configured yet."}
            </p>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <input
            type="checkbox"
            checked={props.sharedDiscordEnabledDraft}
            onChange={(event) => props.onSharedDiscordEnabledDraftChange(event.target.checked)}
            style={{ width: "1rem", height: "1rem" }}
          />
          <span>Enable shared Discord bot</span>
        </label>

        <label>
          <strong>Bot token (leave blank to keep existing)</strong>
          <input
            type="password"
            value={props.sharedDiscordTokenDraft}
            onChange={(event) => props.onSharedDiscordTokenDraftChange(event.target.value)}
            placeholder="MTA..."
            autoComplete="off"
          />
        </label>

        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={props.isSaving}>
            {props.isSaving ? "Saving..." : "Save Discord Shared Bot"}
          </button>
        </div>
      </form>

      <form className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }} onSubmit={(event) => void props.onSaveSharedTelegramSettings(event)}>
        <div className="section-head" style={{ marginBottom: "0.65rem" }}>
          <div>
            <strong>Shared Telegram bot</strong>
            <p className="hint-text" style={{ margin: "0.25rem 0 0" }}>
              {props.sharedConnectors?.telegram.hasToken ? "Token is configured." : "No token configured yet."}
            </p>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <input
            type="checkbox"
            checked={props.sharedTelegramEnabledDraft}
            onChange={(event) => props.onSharedTelegramEnabledDraftChange(event.target.checked)}
            style={{ width: "1rem", height: "1rem" }}
          />
          <span>Enable shared Telegram bot</span>
        </label>

        <label>
          <strong>Telegram ingest mode</strong>
          <select
            value={props.sharedTelegramIngestModeDraft}
            onChange={(event) => props.onSharedTelegramIngestModeDraftChange(event.target.value as "webhook" | "polling")}
          >
            <option value="webhook">Webhook</option>
            <option value="polling">Polling</option>
          </select>
        </label>

        <label>
          <strong>Bot token (leave blank to keep existing)</strong>
          <input
            type="password"
            value={props.sharedTelegramTokenDraft}
            onChange={(event) => props.onSharedTelegramTokenDraftChange(event.target.value)}
            placeholder="123456789:AA..."
            autoComplete="off"
          />
        </label>

        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={props.isSaving}>
            {props.isSaving ? "Saving..." : "Save Telegram Shared Bot"}
          </button>
        </div>
      </form>

      <form className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }} onSubmit={(event) => void props.onSaveSharedListmonkSettings(event)}>
        <div className="section-head" style={{ marginBottom: "0.65rem" }}>
          <div>
            <strong>Listmonk Email Provider</strong>
            <p className="hint-text" style={{ margin: "0.25rem 0 0" }}>
              {props.sharedConnectors?.listmonk.hasApiToken ? "API token is configured." : "No API token configured yet."}
            </p>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <input
            type="checkbox"
            checked={props.listmonkEnabledDraft}
            onChange={(event) => props.onListmonkEnabledDraftChange(event.target.checked)}
            style={{ width: "1rem", height: "1rem" }}
          />
          <span>Enable Listmonk delivery</span>
        </label>

        <label>
          <strong>Listmonk base URL</strong>
          <input
            type="url"
            value={props.listmonkBaseUrlDraft}
            onChange={(event) => props.onListmonkBaseUrlDraftChange(event.target.value)}
            placeholder="http://listmonk:9000"
          />
        </label>

        <label>
          <strong>API username</strong>
          <input
            value={props.listmonkApiUsernameDraft}
            onChange={(event) => props.onListmonkApiUsernameDraftChange(event.target.value)}
            placeholder="meowbert_api"
          />
        </label>

        <label>
          <strong>API token (leave blank to keep existing)</strong>
          <input
            type="password"
            value={props.listmonkApiTokenDraft}
            onChange={(event) => props.onListmonkApiTokenDraftChange(event.target.value)}
            placeholder="paste API token"
            autoComplete="off"
          />
        </label>

        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={props.isSaving}>
            {props.isSaving ? "Saving..." : "Save Listmonk Settings"}
          </button>
        </div>
      </form>

      <form className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }} onSubmit={(event) => void props.onSaveSharedEmailInboundSettings(event)}>
        <div className="section-head" style={{ marginBottom: "0.65rem" }}>
          <div>
            <strong>Email Inbound (Brevo)</strong>
            <p className="hint-text" style={{ margin: "0.25rem 0 0" }}>
              {props.sharedConnectors?.emailInbound.hasWebhookSecret ? "Webhook secret is configured." : "Webhook secret is not configured yet."}{" "}
              {props.sharedConnectors?.emailInbound.hasBrevoApiKey ? "Brevo API key is configured." : "Brevo API key is not configured yet."}
            </p>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <input
            type="checkbox"
            checked={props.emailInboundEnabledDraft}
            onChange={(event) => props.onEmailInboundEnabledDraftChange(event.target.checked)}
            style={{ width: "1rem", height: "1rem" }}
          />
          <span>Enable email inbound webhook</span>
        </label>

        <label>
          <strong>Inbound domain</strong>
          <input
            value={props.emailInboundDomainDraft}
            onChange={(event) => props.onEmailInboundDomainDraftChange(event.target.value)}
            placeholder="inbound.example.com"
          />
        </label>

        <label>
          <strong>Workspace address mode</strong>
          <select
            value={props.emailInboundAddressModeDraft}
            onChange={(event) => props.onEmailInboundAddressModeDraftChange(event.target.value as "random" | "workspace_custom")}
          >
            <option value="random">Random local-part (server generated)</option>
            <option value="workspace_custom">Workspace owner chooses local-part</option>
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <input
            type="checkbox"
            checked={props.emailInboundDebugLoggingEnabledDraft}
            onChange={(event) => props.onEmailInboundDebugLoggingEnabledDraftChange(event.target.checked)}
            style={{ width: "1rem", height: "1rem" }}
          />
          <span>Enable debug event logging</span>
        </label>

        <label>
          <strong>Webhook token (leave blank to keep existing)</strong>
          <input
            type="password"
            value={props.emailInboundWebhookSecretDraft}
            onChange={(event) => props.onEmailInboundWebhookSecretDraftChange(event.target.value)}
            placeholder="long-random-secret"
            autoComplete="off"
          />
        </label>

        <label>
          <strong>Generated inbound endpoint</strong>
          <input
            value={props.emailInboundWebhookEndpoint ?? props.syncedBrevoWebhookUrl ?? props.emailInboundWebhookEndpointPlaceholder}
            readOnly
          />
          <span className="hint-text">Use this URL in Brevo inbound webhook settings.</span>
        </label>

        <label>
          <strong>Brevo API key (leave blank to keep existing)</strong>
          <input
            type="password"
            value={props.emailInboundBrevoApiKeyDraft}
            onChange={(event) => props.onEmailInboundBrevoApiKeyDraftChange(event.target.value)}
            placeholder="xkeysib-..."
            autoComplete="off"
          />
        </label>

        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={props.isSaving}>
            {props.isSaving ? "Saving..." : "Save Email Inbound Settings"}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={props.isSaving || (!props.emailInboundWebhookEndpoint && !props.syncedBrevoWebhookUrl)}
            onClick={() => void props.onCopyGeneratedEmailWebhookUrl()}
          >
            Copy Endpoint
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={props.isSaving || props.isSyncingBrevoWebhook || !props.canSyncBrevoInboundWebhook}
            onClick={() => void props.onSyncBrevoInboundWebhook()}
          >
            {props.isSyncingBrevoWebhook ? "Syncing Brevo Webhook..." : "Auto-create Brevo Webhook"}
          </button>
        </div>
        {props.hasPendingEmailInboundSecretEdits ? (
          <p className="hint-text" style={{ margin: "0.25rem 0 0" }}>
            Save Email Inbound settings first, then run auto-create to sync Brevo using persisted credentials.
          </p>
        ) : null}
      </form>

      <section className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
        <div className="section-head" style={{ marginBottom: "0.65rem" }}>
          <div>
            <strong>Email Inbound Debug Events</strong>
            <p className="hint-text" style={{ margin: "0.25rem 0 0" }}>
              Recent inbound processing events for troubleshooting delivery and routing issues.
            </p>
          </div>
          <button
            className="btn ghost"
            type="button"
            disabled={props.isRefreshingEmailInboundDebugEvents}
            onClick={() => void props.onReloadEmailInboundDebugEvents()}
          >
            {props.isRefreshingEmailInboundDebugEvents ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {!props.emailInboundDebugLoggingEnabledDraft ? (
          <p className="hint-text" style={{ margin: "0 0 0.5rem" }}>
            Debug logging is currently off. Enable it above to capture new inbound events.
          </p>
        ) : null}

        {props.emailInboundDebugEvents.length === 0 ? (
          <p className="hint-text" style={{ margin: 0 }}>No debug events recorded yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.65rem", maxHeight: "24rem", overflowY: "auto", paddingRight: "0.25rem" }}>
            {props.emailInboundDebugEvents.map((event) => (
              <article
                key={event.id}
                style={{
                  border: "1px solid var(--border-muted)",
                  borderRadius: "0.5rem",
                  padding: "0.65rem 0.75rem",
                  background: "var(--surface)"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                  <strong>{event.eventType}</strong>
                  <span className="hint-text">{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                <p style={{ margin: "0.35rem 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{event.message}</p>
                <p className="hint-text" style={{ margin: "0 0 0.35rem" }}>
                  Level: {event.level.toUpperCase()}
                  {event.workspaceId ? ` • Workspace: ${event.workspaceId}` : ""}
                  {event.bindingId ? ` • Binding: ${event.bindingId}` : ""}
                </p>
                <details>
                  <summary className="hint-text">Details</summary>
                  <pre style={{ marginTop: "0.45rem", maxHeight: "12rem", overflowY: "auto", whiteSpace: "pre-wrap" }}>
                    {formatDebugDetails(event.details)}
                  </pre>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>

      {props.error ? <p className="error-text">{props.error}</p> : null}
    </div>
  );
}
