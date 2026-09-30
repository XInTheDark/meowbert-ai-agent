import { Code2, Database, Mail, MessageSquare, Send } from "lucide-react";
import { TelegramConnectorTab } from "./connectors/TelegramConnectorTab";
import { DiscordConnectorTab } from "./connectors/DiscordConnectorTab";
import { EmailConnectorTab } from "./connectors/EmailConnectorTab";
import { GitHubConnectorTab } from "./connectors/GitHubConnectorTab";
import { SourcesConnectorTab } from "./connectors/SourcesConnectorTab";
import { useWorkspaceConnectorsController } from "./connectors/useWorkspaceConnectorsController";

export function WorkspaceConnectorsPage() {
  const controller = useWorkspaceConnectorsController();

  return (
    <section className="page-content settings-page">
      <article className="section-card">
        <div className="section-head" data-onboarding-id="connectors-header">
          <div>
            <h3>Workspace Connectors</h3>
            <p className="muted-text">Manage external integrations for this workspace.</p>
          </div>
        </div>

        <div className="tab-row connectors-tab-row" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className={`tab-btn ${controller.activeTab === "telegram" ? "active" : ""}`}
            onClick={() => controller.setActiveTab("telegram")}
          >
            <Send size={14} />
            <span>Telegram</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${controller.activeTab === "discord" ? "active" : ""}`}
            onClick={() => controller.setActiveTab("discord")}
          >
            <MessageSquare size={14} />
            <span>Discord</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${controller.activeTab === "github" ? "active" : ""}`}
            onClick={() => controller.setActiveTab("github")}
          >
            <Code2 size={14} />
            <span>GitHub</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${controller.activeTab === "email" ? "active" : ""}`}
            onClick={() => controller.setActiveTab("email")}
          >
            <Mail size={14} />
            <span>Email</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${controller.activeTab === "sources" ? "active" : ""}`}
            onClick={() => controller.setActiveTab("sources")}
          >
            <Database size={14} />
            <span>Sources</span>
          </button>
        </div>

        {controller.activeTab === "telegram" && (
          <TelegramConnectorTab
            activeEnvironments={controller.activeEnvironments}
            availableAgents={controller.availableAgents}
            availableSkills={controller.availableSkills}
            canManageConnectors={controller.canManageConnectors}
            connector={controller.telegramConnector}
            pairCode={controller.pairCodeByConnector.telegram}
            sharedTelegramReady={controller.sharedTelegramReady}
            displayedTelegramWebhookUrl={controller.displayedTelegramWebhookUrl}
            connectionMode={controller.telegramConnectionMode}
            mode={controller.telegramMode}
            botToken={controller.telegramBotToken}
            defaultEnvironmentId={controller.telegramDefaultEnvironmentId}
            agentId={controller.telegramAgentId}
            tools={controller.telegramTools}
            prefixEnabled={controller.telegramPrefixEnabled}
            keywordEnabled={controller.telegramKeywordEnabled}
            llmFallbackEnabled={controller.telegramLlmFallbackEnabled}
            defaultAgentId={controller.defaultAgentId}
            isLoading={controller.isLoading}
            isSaving={controller.isSaving}
            loadError={controller.loadError}
            saveError={controller.saveError}
            workspaceMemoryEnabled={controller.workspaceMemoryEnabled}
            onIssueCode={() => controller.handlePairCodeIssue("telegram")}
            onSubmit={controller.handleTelegramSetup}
            onConnectionModeChange={controller.setTelegramConnectionMode}
            onModeChange={controller.setTelegramMode}
            onBotTokenChange={controller.setTelegramBotToken}
            onDefaultEnvironmentChange={controller.setTelegramDefaultEnvironmentId}
            onAgentChange={controller.setTelegramAgentId}
            onToolsChange={controller.setTelegramTools}
            onPrefixEnabledChange={controller.setTelegramPrefixEnabled}
            onKeywordEnabledChange={controller.setTelegramKeywordEnabled}
            onLlmFallbackEnabledChange={controller.setTelegramLlmFallbackEnabled}
            onRefresh={() => controller.loadConnectors()}
          />
        )}

        {controller.activeTab === "discord" && (
          <DiscordConnectorTab
            activeEnvironments={controller.activeEnvironments}
            availableAgents={controller.availableAgents}
            availableSkills={controller.availableSkills}
            canManageConnectors={controller.canManageConnectors}
            connector={controller.discordConnector}
            pairCode={controller.pairCodeByConnector.discord}
            sharedDiscordReady={controller.sharedDiscordReady}
            connectionMode={controller.discordConnectionMode}
            botToken={controller.discordBotToken}
            defaultEnvironmentId={controller.discordDefaultEnvironmentId}
            agentId={controller.discordAgentId}
            tools={controller.discordTools}
            prefixEnabled={controller.discordPrefixEnabled}
            keywordEnabled={controller.discordKeywordEnabled}
            llmFallbackEnabled={controller.discordLlmFallbackEnabled}
            channelHistoryEnabled={controller.discordChannelHistoryEnabled}
            channelHistoryMaxCharsDraft={controller.discordChannelHistoryMaxCharsDraft}
            channelHistoryIncludePinnedMessages={controller.discordChannelHistoryIncludePinnedMessages}
            defaultAgentId={controller.defaultAgentId}
            isLoading={controller.isLoading}
            isSaving={controller.isSaving}
            loadError={controller.loadError}
            saveError={controller.saveError}
            workspaceMemoryEnabled={controller.workspaceMemoryEnabled}
            onIssueCode={() => controller.handlePairCodeIssue("discord")}
            onSubmit={controller.handleDiscordSetup}
            onConnectionModeChange={controller.setDiscordConnectionMode}
            onBotTokenChange={controller.setDiscordBotToken}
            onDefaultEnvironmentChange={controller.setDiscordDefaultEnvironmentId}
            onAgentChange={controller.setDiscordAgentId}
            onToolsChange={controller.setDiscordTools}
            onPrefixEnabledChange={controller.setDiscordPrefixEnabled}
            onKeywordEnabledChange={controller.setDiscordKeywordEnabled}
            onLlmFallbackEnabledChange={controller.setDiscordLlmFallbackEnabled}
            onChannelHistoryEnabledChange={controller.setDiscordChannelHistoryEnabled}
            onChannelHistoryMaxCharsDraftChange={controller.setDiscordChannelHistoryMaxCharsDraft}
            onChannelHistoryIncludePinnedMessagesChange={controller.setDiscordChannelHistoryIncludePinnedMessages}
            onRefresh={() => controller.loadConnectors()}
          />
        )}

        {controller.activeTab === "email" && (
          <EmailConnectorTab
            activeEnvironments={controller.activeEnvironments}
            availableAgents={controller.availableAgents}
            availableSkills={controller.availableSkills}
            canManageConnectors={controller.canManageConnectors}
            connector={controller.emailBinding}
            status={controller.emailConnectorStatus}
            displayedEmailAddress={controller.displayedEmailAddress}
            emailAdminReady={controller.emailAdminReady}
            emailAddressMode={controller.emailAddressMode}
            emailLocalPartDraft={controller.emailLocalPartDraft}
            senderPolicy={controller.emailSenderPolicy}
            trustedAddressesDraft={controller.emailTrustedAddressesDraft}
            defaultEnvironmentId={controller.emailDefaultEnvironmentId}
            agentId={controller.emailAgentId}
            tools={controller.emailTools}
            prefixEnabled={controller.emailPrefixEnabled}
            keywordEnabled={controller.emailKeywordEnabled}
            llmFallbackEnabled={controller.emailLlmFallbackEnabled}
            defaultAgentId={controller.defaultAgentId}
            isLoading={controller.isLoading}
            isSaving={controller.isSaving}
            loadError={controller.loadError}
            saveError={controller.saveError}
            workspaceMemoryEnabled={controller.workspaceMemoryEnabled}
            onSubmit={controller.handleEmailSetup}
            onDisconnect={() => void controller.handleEmailDisconnect()}
            onLocalPartChange={controller.setEmailLocalPartDraft}
            onSenderPolicyChange={controller.setEmailSenderPolicy}
            onTrustedAddressesChange={controller.setEmailTrustedAddressesDraft}
            onDefaultEnvironmentChange={controller.setEmailDefaultEnvironmentId}
            onAgentChange={controller.setEmailAgentId}
            onToolsChange={controller.setEmailTools}
            onPrefixEnabledChange={controller.setEmailPrefixEnabled}
            onKeywordEnabledChange={controller.setEmailKeywordEnabled}
            onLlmFallbackEnabledChange={controller.setEmailLlmFallbackEnabled}
            onRefresh={() => controller.loadConnectors()}
          />
        )}

        {controller.activeTab === "github" && (
          <GitHubConnectorTab
            activeEnvironments={controller.activeEnvironments}
            availableAgents={controller.availableAgents}
            availableSkills={controller.availableSkills}
            binding={controller.githubBinding}
            status={controller.githubConnector}
            pairCode={controller.pairCodeByConnector.github}
            canManageConnectors={controller.canManageConnectors}
            canManageGithub={controller.canManageGithub}
            githubAppConfigured={controller.githubAppConfigured}
            githubInstallationConnected={controller.githubInstallationConnected}
            displayedGithubWebhookUrl={controller.displayedGithubWebhookUrl}
            defaultEnvironmentId={controller.githubDefaultEnvironmentId}
            agentId={controller.githubAgentId}
            tools={controller.githubTools}
            prefixEnabled={controller.githubPrefixEnabled}
            keywordEnabled={controller.githubKeywordEnabled}
            llmFallbackEnabled={controller.githubLlmFallbackEnabled}
            githubDefaultOrgDraft={controller.githubDefaultOrgDraft}
            githubAppConfigJsonDraft={controller.githubAppConfigJsonDraft}
            defaultAgentId={controller.defaultAgentId}
            isLoading={controller.isLoading}
            isSaving={controller.isSaving}
            loadError={controller.loadError}
            saveError={controller.saveError}
            workspaceMemoryEnabled={controller.workspaceMemoryEnabled}
            onIssueCode={() => controller.handlePairCodeIssue("github")}
            onAppConfigSubmit={controller.handleGitHubAppConfigSave}
            onConnectorSubmit={controller.handleGitHubConnectorSetup}
            onDefaultOrgSubmit={controller.handleGitHubDefaultOrgSave}
            onConnectInstall={() => void controller.handleGitHubConnect()}
            onConnectExistingInstall={() => void controller.handleGitHubConnectExisting()}
            onDisconnect={() => void controller.handleGitHubDisconnect()}
            onDefaultEnvironmentChange={controller.setGithubDefaultEnvironmentId}
            onAgentChange={controller.setGithubAgentId}
            onToolsChange={controller.setGithubTools}
            onPrefixEnabledChange={controller.setGithubPrefixEnabled}
            onKeywordEnabledChange={controller.setGithubKeywordEnabled}
            onLlmFallbackEnabledChange={controller.setGithubLlmFallbackEnabled}
            onDefaultOrgChange={controller.setGithubDefaultOrgDraft}
            onAppConfigJsonChange={controller.setGithubAppConfigJsonDraft}
            onRefresh={() => controller.loadConnectors()}
          />
        )}

        {controller.activeTab === "sources" && (
          <SourcesConnectorTab
            sources={controller.sources}
            canManage={controller.sourcesCanManage}
            isLoading={controller.sourcesLoading}
            isSaving={controller.sourcesSaving}
            error={controller.sourcesError}
            onConnect={controller.handleSourceConnect}
            onDisconnect={controller.handleSourceDisconnect}
            onConfigureRclone={controller.handleSourceConfigureRclone}
            onRefresh={controller.loadSources}
          />
        )}
      </article>
    </section>
  );
}
