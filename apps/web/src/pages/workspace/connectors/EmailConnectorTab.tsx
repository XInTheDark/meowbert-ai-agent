import type { FormEventHandler } from "react";
import { AdvancedFlagsCard, DefaultEnvironmentField } from "../../../components/connectors/ConnectorSettingsSections";
import { AgentDropdown } from "../../../components/tasks/AgentDropdown";
import { ToolOptionsDropdown } from "../../../components/tasks/ToolOptionsDropdown";
import type { TaskToolOptions } from "../../../lib/types";
import type { ConnectorBinding, EmailConnectorStatusResponse } from "./workspaceConnectorsTypes";
import type { ConnectorPanelSharedProps } from "./workspaceConnectorPanelShared";

interface EmailConnectorTabProps extends ConnectorPanelSharedProps {
  connector: ConnectorBinding | null;
  status: EmailConnectorStatusResponse | null;
  displayedEmailAddress: string | null;
  emailAdminReady: boolean;
  emailAddressMode: "random" | "workspace_custom";
  emailLocalPartDraft: string;
  senderPolicy: "allow_any" | "trusted_only";
  trustedAddressesDraft: string;
  defaultEnvironmentId: string;
  agentId: string | null;
  tools: TaskToolOptions;
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onDisconnect: () => void;
  onLocalPartChange: (value: string) => void;
  onSenderPolicyChange: (value: "allow_any" | "trusted_only") => void;
  onTrustedAddressesChange: (value: string) => void;
  onDefaultEnvironmentChange: (value: string) => void;
  onAgentChange: (value: string | null) => void;
  onToolsChange: (value: TaskToolOptions) => void;
  onPrefixEnabledChange: (value: boolean) => void;
  onKeywordEnabledChange: (value: boolean) => void;
  onLlmFallbackEnabledChange: (value: boolean) => void;
}

export function EmailConnectorTab(props: EmailConnectorTabProps) {
  const {
    activeEnvironments,
    availableAgents,
    availableSkills,
    canManageConnectors,
    connector,
    defaultAgentId,
    defaultEnvironmentId,
    displayedEmailAddress,
    emailAddressMode,
    emailAdminReady,
    emailLocalPartDraft,
    isLoading,
    isSaving,
    keywordEnabled,
    llmFallbackEnabled,
    loadError,
    onAgentChange,
    onDefaultEnvironmentChange,
    onDisconnect,
    onKeywordEnabledChange,
    onLlmFallbackEnabledChange,
    onLocalPartChange,
    onPrefixEnabledChange,
    onRefresh,
    onSenderPolicyChange,
    onSubmit,
    onToolsChange,
    onTrustedAddressesChange,
    prefixEnabled,
    saveError,
    senderPolicy,
    status,
    tools,
    trustedAddressesDraft,
    workspaceMemoryEnabled
  } = props;

  return (
    <form className="stack-form" onSubmit={onSubmit} style={{ marginTop: "1rem" }}>
      <div className="section-head" style={{ marginBottom: "1rem" }}>
        <p className="muted-text" style={{ margin: 0 }}>
          Assign a workspace email address. Inbound emails route into tasks and responses are sent back by email.
        </p>
        <span className={`badge ${connector?.status === "active" ? "good" : "muted"}`}>
          {connector ? `Email: ${connector.status}` : "Email: not configured"}
        </span>
      </div>

      <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
        <strong>Inbound status</strong>
        <p className="hint-text" style={{ margin: "0.35rem 0 0" }}>
          {emailAdminReady
            ? `Inbound domain is ${status?.admin.inboundDomain}. Webhook and Brevo API credentials are ready.`
            : "Platform admin still needs to enable/configure Email Inbound in Admin → Connectors."}
        </p>
        {displayedEmailAddress ? (
          <p style={{ margin: "0.45rem 0 0", wordBreak: "break-all" }}>
            Workspace address: <code>{displayedEmailAddress}</code>
          </p>
        ) : null}
      </div>

      <label>
        <strong>Address mode</strong>
        <input value={emailAddressMode === "workspace_custom" ? "Workspace custom local-part" : "Random local-part (admin managed)"} disabled />
      </label>

      <label>
        <strong>Local-part</strong>
        <input
          value={emailLocalPartDraft}
          onChange={(event) => onLocalPartChange(event.target.value)}
          placeholder={emailAddressMode === "workspace_custom" ? "team-inbox" : "auto-generated"}
          disabled={!canManageConnectors || emailAddressMode !== "workspace_custom"}
        />
        <span className="hint-text">
          {emailAddressMode === "workspace_custom"
            ? "Workspace owners can choose this local-part."
            : "Admin policy is set to random mode; local-part is generated and locked."}
        </span>
      </label>

      <label>
        <strong>Sender policy</strong>
        <select
          value={senderPolicy}
          onChange={(event) => onSenderPolicyChange(event.target.value as "allow_any" | "trusted_only")}
          disabled={!canManageConnectors}
        >
          <option value="allow_any">Allow any incoming sender (risky)</option>
          <option value="trusted_only">Only allow trusted addresses</option>
        </select>
      </label>

      {senderPolicy === "trusted_only" ? (
        <label>
          <strong>Trusted addresses (comma-separated)</strong>
          <input
            value={trustedAddressesDraft}
            onChange={(event) => onTrustedAddressesChange(event.target.value)}
            placeholder="alice@example.com, buildbot@example.com"
            disabled={!canManageConnectors}
          />
          <span className="hint-text">Untrusted senders are ignored without response.</span>
        </label>
      ) : null}

      <DefaultEnvironmentField
        value={defaultEnvironmentId}
        environments={activeEnvironments}
        onChange={onDefaultEnvironmentChange}
        hint="Used as the safe fallback destination for email-created tasks."
        disabled={!canManageConnectors}
      />

      {availableAgents.length > 0 ? (
        <label>
          <strong>Agent</strong>
          <AgentDropdown
            availableAgents={availableAgents}
            selectedAgentId={props.agentId}
            defaultAgentId={defaultAgentId}
            onChange={onAgentChange}
            disabled={!canManageConnectors}
            variant="button"
            allowNoSelection
          />
          <span className="hint-text">
            Leave this unset to use the default agent. When selected, every email-triggered run uses that agent preset.
          </span>
        </label>
      ) : null}

      <label>
        <strong>Tools selection</strong>
        <ToolOptionsDropdown
          toolOptions={tools}
          onChange={onToolsChange}
          availableSkills={availableSkills}
          showMemorySearch={workspaceMemoryEnabled}
          disabled={!canManageConnectors}
          variant="button"
          label="Tools selection"
        />
        <span className="hint-text">These defaults are applied to every email-triggered run for this workspace.</span>
      </label>

      <AdvancedFlagsCard
        prefixEnabled={prefixEnabled}
        keywordEnabled={keywordEnabled}
        llmFallbackEnabled={llmFallbackEnabled}
        onPrefixEnabledChange={onPrefixEnabledChange}
        onKeywordEnabledChange={onKeywordEnabledChange}
        onLlmFallbackEnabledChange={onLlmFallbackEnabledChange}
        disabled={!canManageConnectors}
      />

      {!canManageConnectors ? (
        <p className="hint-text" style={{ margin: 0 }}>
          Only workspace owners can change email connector setup.
        </p>
      ) : null}

      {loadError && <p className="error-text">{loadError}</p>}
      {saveError && <p className="error-text">{saveError}</p>}

      <div className="row-actions">
        <button
          className="btn primary"
          type="submit"
          disabled={isSaving || isLoading || activeEnvironments.length === 0 || !canManageConnectors || !emailAdminReady}
        >
          {isSaving ? "Saving..." : connector ? "Update Email Setup" : "Connect Email"}
        </button>
        {connector ? (
          <button className="btn ghost" type="button" disabled={isSaving || !canManageConnectors} onClick={onDisconnect}>
            Disconnect
          </button>
        ) : null}
        <button className="btn ghost" type="button" disabled={isSaving} onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </form>
  );
}
