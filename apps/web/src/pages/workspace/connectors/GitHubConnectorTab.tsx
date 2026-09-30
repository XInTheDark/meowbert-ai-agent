import type { FormEventHandler } from "react";
import { AdvancedFlagsCard, DefaultEnvironmentField, PairingCard, type PairCodeState } from "../../../components/connectors/ConnectorSettingsSections";
import { AgentDropdown } from "../../../components/tasks/AgentDropdown";
import { ToolOptionsDropdown } from "../../../components/tasks/ToolOptionsDropdown";
import type { TaskToolOptions } from "../../../lib/types";
import type { ConnectorBinding, GitHubConnectorStatusResponse } from "./workspaceConnectorsTypes";
import type { ConnectorPanelSharedProps } from "./workspaceConnectorPanelShared";

interface GitHubConnectorTabProps extends ConnectorPanelSharedProps {
  binding: ConnectorBinding | null;
  status: GitHubConnectorStatusResponse | null;
  pairCode: PairCodeState | null;
  canManageGithub: boolean;
  githubAppConfigured: boolean;
  githubInstallationConnected: boolean;
  displayedGithubWebhookUrl: string | null;
  defaultEnvironmentId: string;
  agentId: string | null;
  tools: TaskToolOptions;
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
  githubDefaultOrgDraft: string;
  githubAppConfigJsonDraft: string;
  onIssueCode: () => void;
  onAppConfigSubmit: FormEventHandler<HTMLFormElement>;
  onConnectorSubmit: FormEventHandler<HTMLFormElement>;
  onDefaultOrgSubmit: FormEventHandler<HTMLFormElement>;
  onConnectInstall: () => void;
  onConnectExistingInstall: () => void;
  onDisconnect: () => void;
  onDefaultEnvironmentChange: (value: string) => void;
  onAgentChange: (value: string | null) => void;
  onToolsChange: (value: TaskToolOptions) => void;
  onPrefixEnabledChange: (value: boolean) => void;
  onKeywordEnabledChange: (value: boolean) => void;
  onLlmFallbackEnabledChange: (value: boolean) => void;
  onDefaultOrgChange: (value: string) => void;
  onAppConfigJsonChange: (value: string) => void;
}

export function GitHubConnectorTab(props: GitHubConnectorTabProps) {
  const {
    activeEnvironments,
    availableAgents,
    availableSkills,
    binding,
    canManageConnectors,
    canManageGithub,
    defaultAgentId,
    defaultEnvironmentId,
    displayedGithubWebhookUrl,
    githubAppConfigJsonDraft,
    githubAppConfigured,
    githubDefaultOrgDraft,
    githubInstallationConnected,
    isLoading,
    isSaving,
    keywordEnabled,
    llmFallbackEnabled,
    loadError,
    onAgentChange,
    onAppConfigJsonChange,
    onAppConfigSubmit,
    onConnectInstall,
    onConnectorSubmit,
    onConnectExistingInstall,
    onDefaultEnvironmentChange,
    onDefaultOrgChange,
    onDefaultOrgSubmit,
    onDisconnect,
    onIssueCode,
    onKeywordEnabledChange,
    onLlmFallbackEnabledChange,
    onPrefixEnabledChange,
    onRefresh,
    onToolsChange,
    pairCode,
    prefixEnabled,
    saveError,
    status,
    tools,
    workspaceMemoryEnabled
  } = props;

  return (
    <div className="stack-form" style={{ marginTop: "1rem" }}>
      <div className="section-head" style={{ marginBottom: "1rem" }}>
        <p className="muted-text" style={{ margin: 0 }}>
          Configure a workspace GitHub App, install it on target repositories, then mention the app bot in
          issue/PR comments to create tasks. Only paired GitHub users can trigger runs.
        </p>
        <span className={`badge ${binding?.status === "active" ? "good" : "muted"}`}>
          {binding ? `GitHub: ${binding.status}` : "GitHub: not configured"}
        </span>
      </div>

      <PairingCard
        connectorLabel="GitHub"
        pairing={binding?.pairing}
        pairCode={pairCode}
        isSaving={isSaving}
        isConnectorActive={binding?.status === "active"}
        onIssueCode={onIssueCode}
      />

      <form className="stack-form" onSubmit={onAppConfigSubmit}>
        <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
          <strong>GitHub App setup checklist</strong>
          <ol className="hint-text" style={{ margin: "0.45rem 0 0", paddingLeft: "1.2rem" }}>
            <li>Create a GitHub App in Developer Settings.</li>
            <li>Set Webhook URL to <code>{status?.setup.webhookUrl ?? ""}</code>.</li>
            <li>Set Setup URL to <code>{status?.setup.callbackUrl ?? ""}</code>.</li>
            <li>
              Subscribe to events:{" "}
              {status?.setup.requiredEvents?.map((eventName, index) =>
                index === 0 ? <code key={eventName}>{eventName}</code> : <span key={eventName}>, <code>{eventName}</code></span>
              )}
              .
            </li>
            <li>
              Grant repository permissions: <code>Issues</code> read/write, <code>Pull requests</code> read/write,
              and <code>Contents</code> read/write for private repo clone and push.
            </li>
            <li>Generate a private key in GitHub and paste credentials JSON below.</li>
          </ol>
        </div>

        <label>
          <strong>GitHub App config JSON</strong>
          <textarea
            value={githubAppConfigJsonDraft}
            onChange={(event) => onAppConfigJsonChange(event.target.value)}
            rows={12}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            disabled={!canManageGithub || isSaving}
          />
          <span className="hint-text">
            Required keys: <code>appId</code>, <code>appSlug</code>, <code>privateKeyPem</code>, <code>webhookSecret</code>.
          </span>
          <span className="hint-text" style={{ display: "block", marginTop: "0.35rem" }}>
            <strong>appId</strong>: numeric GitHub App ID. <strong>appSlug</strong>: the app slug from{" "}
            <code>https://github.com/apps/&lt;slug&gt;</code> (and the mention handle <code>@slug</code>).
          </span>
          <span className="hint-text" style={{ display: "block", marginTop: "0.25rem" }}>
            <strong>privateKeyPem</strong>: keep the PEM as one JSON string and escape line breaks as{" "}
            <code>\\n</code>. <strong>webhookSecret</strong>: secret from GitHub App webhook settings.
          </span>
          <span className="hint-text" style={{ display: "block", marginTop: "0.25rem" }}>
            <strong>clientId</strong>/<strong>clientSecret</strong> are optional for this connector flow.
            You can leave both as <code>null</code>.
          </span>
        </label>

        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={!canManageGithub || isSaving}>
            {isSaving ? "Saving..." : "Save GitHub App Config"}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={isSaving || !canManageGithub || !githubAppConfigured}
            onClick={onConnectInstall}
          >
            {githubInstallationConnected ? "Reinstall / Change Repos" : "Connect & Install App"}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={isSaving || !canManageGithub || !githubAppConfigured}
            onClick={onConnectExistingInstall}
          >
            Use Existing Installation
          </button>
        </div>
      </form>

      <form className="stack-form" onSubmit={onConnectorSubmit}>
        <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
          <strong>Installation status</strong>
          <p className="hint-text" style={{ margin: "0.35rem 0 0" }}>
            {githubInstallationConnected
              ? `Connected installation #${status?.installation.connected ? status.installation.installationId : ""}`
              : "No GitHub App installation connected yet."}
          </p>
          {status?.installation.connected ? (
            <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.45rem" }}>
              <p style={{ margin: 0 }}>
                <strong>Account</strong>: {status.installation.accountLogin ?? "(unknown)"}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Type</strong>: {status.installation.accountType ?? "(unknown)"}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Connected at</strong>: {status.installation.connectedAt ?? "(unknown)"}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Repo access</strong>: {status.installation.access?.repositorySelection ?? "unknown"}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Contents</strong>: {status.installation.access?.contentsPermission ?? "not granted"}
              </p>
              {status.installation.access?.ok === false ? (
                <p className="hint-text" style={{ margin: 0, color: "var(--danger)" }}>
                  Could not verify GitHub App permissions: {status.installation.access.error ?? "unknown error"}
                </p>
              ) : status.installation.access && !status.installation.access.canWriteContents ? (
                <p className="hint-text" style={{ margin: 0, color: "var(--danger)" }}>
                  Private repo clone/push needs GitHub App Contents read/write permission. Update the App permissions,
                  then reinstall or accept the permission update in GitHub.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DefaultEnvironmentField
          value={defaultEnvironmentId}
          environments={activeEnvironments}
          onChange={onDefaultEnvironmentChange}
          hint="Used as the fallback destination for GitHub mention-triggered tasks."
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
              Leave this unset to use the default agent. When selected, every GitHub-triggered run uses that agent preset.
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
          <span className="hint-text">These defaults are applied to every GitHub-triggered run for this workspace.</span>
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

        {displayedGithubWebhookUrl ? (
          <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
            <strong>GitHub webhook URL</strong>
            <p style={{ margin: "0.35rem 0 0", wordBreak: "break-word" }}>
              <code>{displayedGithubWebhookUrl}</code>
            </p>
          </div>
        ) : null}

        <div className="row-actions">
          <button
            className="btn primary"
            type="submit"
            disabled={isSaving || isLoading || activeEnvironments.length === 0 || !canManageConnectors || !githubInstallationConnected}
          >
            {isSaving ? "Saving..." : binding ? "Update GitHub Connector" : "Enable GitHub Connector"}
          </button>
          <button className="btn ghost" type="button" disabled={isSaving} onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </form>

      <form className="stack-form" onSubmit={onDefaultOrgSubmit}>
        <label>
          <strong>Default GitHub organization</strong>
          <input
            value={githubDefaultOrgDraft}
            onChange={(event) => onDefaultOrgChange(event.target.value)}
            placeholder="my-org"
            disabled={!githubAppConfigured || !canManageGithub || isSaving}
          />
          <span className="hint-text">
            Used as the default org hint for tasks that create repos unless the prompt specifies another target.
          </span>
        </label>

        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={!githubAppConfigured || !canManageGithub || isSaving}>
            {isSaving ? "Saving..." : "Save GitHub Defaults"}
          </button>
          <button
            className="btn ghost danger-outline"
            type="button"
            disabled={!githubAppConfigured || !canManageGithub || isSaving}
            onClick={onDisconnect}
          >
            Disconnect GitHub
          </button>
        </div>
      </form>

      {loadError && <p className="error-text">{loadError}</p>}
      {saveError && <p className="error-text">{saveError}</p>}
    </div>
  );
}
