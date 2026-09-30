import type { FormEventHandler } from "react";
import { AdvancedFlagsCard, DefaultEnvironmentField, PairingCard, type PairCodeState } from "../../../components/connectors/ConnectorSettingsSections";
import { AgentDropdown } from "../../../components/tasks/AgentDropdown";
import { ToolOptionsDropdown } from "../../../components/tasks/ToolOptionsDropdown";
import type { TaskToolOptions } from "../../../lib/types";
import type { ConnectorBinding } from "./workspaceConnectorsTypes";
import type { ConnectorPanelSharedProps } from "./workspaceConnectorPanelShared";

interface TelegramConnectorTabProps extends ConnectorPanelSharedProps {
  connector: ConnectorBinding | null;
  pairCode: PairCodeState | null;
  sharedTelegramReady: boolean;
  displayedTelegramWebhookUrl: string | null;
  connectionMode: "custom" | "shared";
  mode: "webhook" | "polling";
  botToken: string;
  defaultEnvironmentId: string;
  agentId: string | null;
  tools: TaskToolOptions;
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
  onIssueCode: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onConnectionModeChange: (value: "custom" | "shared") => void;
  onModeChange: (value: "webhook" | "polling") => void;
  onBotTokenChange: (value: string) => void;
  onDefaultEnvironmentChange: (value: string) => void;
  onAgentChange: (value: string | null) => void;
  onToolsChange: (value: TaskToolOptions) => void;
  onPrefixEnabledChange: (value: boolean) => void;
  onKeywordEnabledChange: (value: boolean) => void;
  onLlmFallbackEnabledChange: (value: boolean) => void;
}

export function TelegramConnectorTab(props: TelegramConnectorTabProps) {
  const {
    activeEnvironments,
    availableAgents,
    availableSkills,
    botToken,
    canManageConnectors,
    connectionMode,
    connector,
    defaultAgentId,
    defaultEnvironmentId,
    displayedTelegramWebhookUrl,
    isLoading,
    isSaving,
    keywordEnabled,
    llmFallbackEnabled,
    loadError,
    mode,
    onAgentChange,
    onBotTokenChange,
    onConnectionModeChange,
    onDefaultEnvironmentChange,
    onIssueCode,
    onKeywordEnabledChange,
    onLlmFallbackEnabledChange,
    onModeChange,
    onPrefixEnabledChange,
    onRefresh,
    onSubmit,
    onToolsChange,
    pairCode,
    prefixEnabled,
    saveError,
    sharedTelegramReady,
    tools,
    workspaceMemoryEnabled
  } = props;

  return (
    <form className="stack-form" onSubmit={onSubmit} style={{ marginTop: "1rem" }}>
      <div className="section-head" style={{ marginBottom: "1rem" }}>
        <p className="muted-text" style={{ margin: 0 }}>
          Connect Telegram once per workspace. Only paired Telegram accounts can create tasks.
        </p>
        <span className={`badge ${connector?.status === "active" ? "good" : "muted"}`}>
          {connector ? `Telegram: ${connector.status}` : "Telegram: not configured"}
        </span>
      </div>

      <PairingCard
        connectorLabel="Telegram"
        pairing={connector?.pairing}
        pairCode={pairCode}
        isSaving={isSaving}
        isConnectorActive={connector?.status === "active"}
        onIssueCode={onIssueCode}
      />

      <label>
        <strong>Connection mode</strong>
        <select
          value={connectionMode}
          onChange={(event) => onConnectionModeChange(event.target.value as "custom" | "shared")}
          disabled={!canManageConnectors}
        >
          <option value="custom">Custom bot token</option>
          <option value="shared">Shared bot (platform-managed)</option>
        </select>
        <span className="hint-text">Workspace owners can switch between custom and shared bot setup.</span>
      </label>

      {connectionMode === "custom" ? (
        <>
          <label>
            <strong>Mode</strong>
            <select
              value={mode}
              onChange={(event) => onModeChange(event.target.value as "webhook" | "polling")}
              disabled={!canManageConnectors}
            >
              <option value="webhook">Webhook (recommended for production)</option>
              <option value="polling">Polling (recommended for local development)</option>
            </select>
            <span className="hint-text">
              Webhook mode needs a public HTTPS API URL. Polling mode fetches updates directly from Telegram.
            </span>
          </label>

          <label>
            <strong>Telegram bot token</strong>
            <input
              type="password"
              value={botToken}
              onChange={(event) => onBotTokenChange(event.target.value)}
              placeholder="123456789:AA..."
              autoComplete="off"
              disabled={!canManageConnectors}
            />
            <span className="hint-text">Create a bot in @BotFather, then paste the token here.</span>
          </label>
        </>
      ) : (
        <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
          <strong>Shared Telegram bot</strong>
          <p className="hint-text" style={{ margin: "0.35rem 0 0" }}>
            {sharedTelegramReady
              ? "Shared Telegram bot is available. Save to attach this workspace to it."
              : "Platform admin has not enabled a shared Telegram bot yet."}
          </p>
        </div>
      )}

      <DefaultEnvironmentField
        value={defaultEnvironmentId}
        environments={activeEnvironments}
        onChange={onDefaultEnvironmentChange}
        hint="Used as the safe fallback destination for Telegram tasks."
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
            Leave this unset to use the default agent. When selected, every Telegram-triggered run uses that agent preset.
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
        <span className="hint-text">These defaults are applied to every Telegram-triggered run for this workspace.</span>
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
          Only workspace owners can change connector setup. You can still pair your own account below.
        </p>
      ) : null}

      {displayedTelegramWebhookUrl ? (
        <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
          <strong>Webhook endpoint</strong>
          <p style={{ margin: "0.35rem 0 0", wordBreak: "break-word" }}>
            <code>{displayedTelegramWebhookUrl}</code>
          </p>
          <p className="hint-text" style={{ margin: "0.35rem 0 0" }}>
            Setup now registers this automatically when webhook mode is selected.
          </p>
        </div>
      ) : null}

      {connectionMode === "custom" && mode === "polling" ? (
        <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
          <strong>Polling mode</strong>
          <p className="hint-text" style={{ margin: "0.35rem 0 0" }}>
            The API service will poll Telegram every few seconds and create tasks from new messages.
          </p>
        </div>
      ) : null}

      {connectionMode === "shared" ? (
        <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
          <strong>Shared bot commands</strong>
          <p className="hint-text" style={{ margin: "0.35rem 0 0" }}>
            In DM, use /workspace list and /workspace use &lt;slug&gt; to choose routing context.
          </p>
        </div>
      ) : null}

      {loadError && <p className="error-text">{loadError}</p>}
      {saveError && <p className="error-text">{saveError}</p>}

      <div className="row-actions">
        <button
          className="btn primary"
          type="submit"
          disabled={isSaving || isLoading || activeEnvironments.length === 0 || !canManageConnectors}
        >
          {isSaving ? "Saving..." : connector ? "Update Telegram Setup" : "Connect Telegram"}
        </button>
        <button className="btn ghost" type="button" disabled={isSaving} onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </form>
  );
}
