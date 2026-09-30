import type { FormEventHandler } from "react";
import { AdvancedFlagsCard, DefaultEnvironmentField, PairingCard, type PairCodeState } from "../../../components/connectors/ConnectorSettingsSections";
import { AgentDropdown } from "../../../components/tasks/AgentDropdown";
import { ToolOptionsDropdown } from "../../../components/tasks/ToolOptionsDropdown";
import type { TaskToolOptions } from "../../../lib/types";
import type { ConnectorBinding } from "./workspaceConnectorsTypes";
import type { ConnectorPanelSharedProps } from "./workspaceConnectorPanelShared";

interface DiscordConnectorTabProps extends ConnectorPanelSharedProps {
  connector: ConnectorBinding | null;
  pairCode: PairCodeState | null;
  sharedDiscordReady: boolean;
  connectionMode: "custom" | "shared";
  botToken: string;
  defaultEnvironmentId: string;
  agentId: string | null;
  tools: TaskToolOptions;
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
  channelHistoryEnabled: boolean;
  channelHistoryMaxCharsDraft: string;
  channelHistoryIncludePinnedMessages: boolean;
  onIssueCode: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onConnectionModeChange: (value: "custom" | "shared") => void;
  onBotTokenChange: (value: string) => void;
  onDefaultEnvironmentChange: (value: string) => void;
  onAgentChange: (value: string | null) => void;
  onToolsChange: (value: TaskToolOptions) => void;
  onPrefixEnabledChange: (value: boolean) => void;
  onKeywordEnabledChange: (value: boolean) => void;
  onLlmFallbackEnabledChange: (value: boolean) => void;
  onChannelHistoryEnabledChange: (value: boolean) => void;
  onChannelHistoryMaxCharsDraftChange: (value: string) => void;
  onChannelHistoryIncludePinnedMessagesChange: (value: boolean) => void;
}

export function DiscordConnectorTab(props: DiscordConnectorTabProps) {
  const {
    activeEnvironments,
    availableAgents,
    availableSkills,
    canManageConnectors,
    channelHistoryEnabled,
    channelHistoryIncludePinnedMessages,
    channelHistoryMaxCharsDraft,
    connectionMode,
    connector,
    defaultAgentId,
    defaultEnvironmentId,
    isLoading,
    isSaving,
    keywordEnabled,
    llmFallbackEnabled,
    loadError,
    onAgentChange,
    onBotTokenChange,
    onChannelHistoryEnabledChange,
    onChannelHistoryIncludePinnedMessagesChange,
    onChannelHistoryMaxCharsDraftChange,
    onConnectionModeChange,
    onDefaultEnvironmentChange,
    onIssueCode,
    onKeywordEnabledChange,
    onLlmFallbackEnabledChange,
    onPrefixEnabledChange,
    onRefresh,
    onSubmit,
    onToolsChange,
    pairCode,
    prefixEnabled,
    saveError,
    sharedDiscordReady,
    tools,
    workspaceMemoryEnabled
  } = props;

  return (
    <form className="stack-form" onSubmit={onSubmit} style={{ marginTop: "1rem" }}>
      <div className="section-head" style={{ marginBottom: "1rem" }}>
        <p className="muted-text" style={{ margin: 0 }}>
          Connect a Discord bot via gateway. Only paired users are allowed, and guild messages must mention the bot.
        </p>
        <span className={`badge ${connector?.status === "active" ? "good" : "muted"}`}>
          {connector ? `Discord: ${connector.status}` : "Discord: not configured"}
        </span>
      </div>

      <PairingCard
        connectorLabel="Discord"
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
        <label>
          <strong>Discord bot token</strong>
          <input
            type="password"
            value={props.botToken}
            onChange={(event) => onBotTokenChange(event.target.value)}
            placeholder="MTA..."
            autoComplete="off"
            disabled={!canManageConnectors}
          />
          <span className="hint-text">Create a bot in Discord Developer Portal and paste the token here.</span>
        </label>
      ) : (
        <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
          <strong>Shared Discord bot</strong>
          <p className="hint-text" style={{ margin: "0.35rem 0 0" }}>
            {sharedDiscordReady
              ? "Shared Discord bot is available. Save to attach this workspace to it."
              : "Platform admin has not enabled a shared Discord bot yet."}
          </p>
        </div>
      )}

      <DefaultEnvironmentField
        value={defaultEnvironmentId}
        environments={activeEnvironments}
        onChange={onDefaultEnvironmentChange}
        hint="Used as the safe fallback destination for Discord tasks."
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
            Leave this unset to use the default agent. When selected, every Discord-triggered run uses that agent preset.
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
        <span className="hint-text">These defaults are applied to every Discord-triggered run for this workspace.</span>
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

      <div className="section-card" style={{ gap: "0.45rem", boxShadow: "none", background: "var(--surface-muted)" }}>
        <strong>Channel history context</strong>
        <p className="hint-text" style={{ margin: 0 }}>
          Optionally include recent channel messages as context for each Discord task message.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <input
            type="checkbox"
            checked={channelHistoryEnabled}
            onChange={(event) => onChannelHistoryEnabledChange(event.target.checked)}
            disabled={!canManageConnectors}
            style={{ width: "1rem", height: "1rem" }}
          />
          <span>Include current channel history</span>
        </label>
        <label>
          <strong>History max chars (optional override)</strong>
          <input
            type="number"
            min={1}
            step={1}
            disabled={!channelHistoryEnabled || !canManageConnectors}
            value={channelHistoryMaxCharsDraft}
            onChange={(event) => onChannelHistoryMaxCharsDraftChange(event.target.value)}
            placeholder="Uses ~20% of project max context window when blank"
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <input
            type="checkbox"
            checked={channelHistoryIncludePinnedMessages}
            disabled={!channelHistoryEnabled || !canManageConnectors}
            onChange={(event) => onChannelHistoryIncludePinnedMessagesChange(event.target.checked)}
            style={{ width: "1rem", height: "1rem" }}
          />
          <span>Prioritize pinned messages (and linked assistant replies)</span>
        </label>
      </div>

      {!canManageConnectors ? (
        <p className="hint-text" style={{ margin: 0 }}>
          Only workspace owners can change connector setup. You can still pair your own account below.
        </p>
      ) : null}

      <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
        <strong>Gateway mode</strong>
        <p className="hint-text" style={{ margin: "0.35rem 0 0" }}>
          Discord messages stream in real time. Paired users can message in DMs, or mention the bot in server channels.
        </p>
      </div>

      {connectionMode === "shared" ? (
        <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
          <strong>Shared bot commands</strong>
          <p className="hint-text" style={{ margin: "0.35rem 0 0" }}>
            Use @Meowbert /workspace list, /workspace use &lt;slug&gt;, /open, /close, /pair @user, /unpair @user.
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
          {isSaving ? "Saving..." : connector ? "Update Discord Setup" : "Connect Discord"}
        </button>
        <button className="btn ghost" type="button" disabled={isSaving} onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </form>
  );
}
