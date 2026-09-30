import { useCallback, useMemo, useState } from "react";
import type { SetStateAction } from "react";
import { useSearchParams } from "react-router-dom";
import type { PairCodeState } from "../../../components/connectors/ConnectorSettingsSections";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import { useAppRuntime } from "../../../contexts/AppRuntimeContext";
import { buildDefaultTaskToolOptions } from "../../../task/taskInputDrafts";
import type { TaskToolOptions } from "../../../lib/types";
import type {
  ConnectorBinding,
  ConnectorTab,
  EmailConnectorStatusResponse,
  GitHubConnectorStatusResponse,
  PairableConnectorType,
  SharedConnectorStatus
} from "./workspaceConnectorsTypes";
import { buildGitHubAppConfigDraft } from "./workspaceConnectorsUtils";
import { useConnectorDefaultEnvironmentSelection } from "./useConnectorDefaultEnvironmentSelection";
import { useWorkspaceConnectorCatalog } from "./useWorkspaceConnectorCatalog";
import { useWorkspaceConnectorsActions } from "./useWorkspaceConnectorsActions";
import { useWorkspaceConnectorsLoading } from "./useWorkspaceConnectorsLoading";
import { useWorkspaceSources } from "./useWorkspaceSources";

function parseConnectorTab(value: string | null): ConnectorTab | null {
  if (value === "telegram" || value === "discord" || value === "github" || value === "email" || value === "sources") {
    return value;
  }

  return null;
}

export function useWorkspaceConnectorsController() {
  const { api, activeWorkspaceId, environments, setFlash, workspaces, workspaceSettings } = useWorkspaceApp();
  const { capabilities, platform } = useAppRuntime();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeEnvironments = useMemo(
    () => environments.filter((environment) => environment.status === "active"),
    [environments]
  );
  const activeWorkspaceRole = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.role ?? null,
    [workspaces, activeWorkspaceId]
  );
  const workspaceMemoryEnabled = workspaceSettings?.memoryEnabled === true;
  const defaultToolOptions = useMemo(
    () => buildDefaultTaskToolOptions({ memorySearch: workspaceMemoryEnabled }),
    [workspaceMemoryEnabled]
  );

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { availableAgents, availableSkills, defaultAgentId } = useWorkspaceConnectorCatalog(api, activeWorkspaceId);

  const [telegramConnector, setTelegramConnector] = useState<ConnectorBinding | null>(null);
  const [telegramConnectionMode, setTelegramConnectionMode] = useState<"custom" | "shared">("custom");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramMode, setTelegramMode] = useState<"webhook" | "polling">("webhook");
  const [telegramDefaultEnvironmentId, setTelegramDefaultEnvironmentId] = useState("");
  const [telegramAgentId, setTelegramAgentId] = useState<string | null>(null);
  const [telegramTools, setTelegramTools] = useState<TaskToolOptions>(defaultToolOptions);
  const [telegramPrefixEnabled, setTelegramPrefixEnabled] = useState(true);
  const [telegramKeywordEnabled, setTelegramKeywordEnabled] = useState(true);
  const [telegramLlmFallbackEnabled, setTelegramLlmFallbackEnabled] = useState(true);
  const [lastSetupWebhookUrl, setLastSetupWebhookUrl] = useState<string | null>(null);

  const [discordConnector, setDiscordConnector] = useState<ConnectorBinding | null>(null);
  const [discordConnectionMode, setDiscordConnectionMode] = useState<"custom" | "shared">("custom");
  const [discordBotToken, setDiscordBotToken] = useState("");
  const [discordDefaultEnvironmentId, setDiscordDefaultEnvironmentId] = useState("");
  const [discordAgentId, setDiscordAgentId] = useState<string | null>(null);
  const [discordTools, setDiscordTools] = useState<TaskToolOptions>(defaultToolOptions);
  const [discordPrefixEnabled, setDiscordPrefixEnabled] = useState(true);
  const [discordKeywordEnabled, setDiscordKeywordEnabled] = useState(true);
  const [discordLlmFallbackEnabled, setDiscordLlmFallbackEnabled] = useState(true);
  const [discordChannelHistoryEnabled, setDiscordChannelHistoryEnabled] = useState(false);
  const [discordChannelHistoryMaxCharsDraft, setDiscordChannelHistoryMaxCharsDraft] = useState("");
  const [discordChannelHistoryIncludePinnedMessages, setDiscordChannelHistoryIncludePinnedMessages] = useState(true);

  const [emailBinding, setEmailBinding] = useState<ConnectorBinding | null>(null);
  const [emailConnectorStatus, setEmailConnectorStatus] = useState<EmailConnectorStatusResponse | null>(null);
  const [emailLocalPartDraft, setEmailLocalPartDraft] = useState("");
  const [emailSenderPolicy, setEmailSenderPolicy] = useState<"allow_any" | "trusted_only">("allow_any");
  const [emailTrustedAddressesDraft, setEmailTrustedAddressesDraft] = useState("");
  const [emailDefaultEnvironmentId, setEmailDefaultEnvironmentId] = useState("");
  const [emailAgentId, setEmailAgentId] = useState<string | null>(null);
  const [emailTools, setEmailTools] = useState<TaskToolOptions>(defaultToolOptions);
  const [emailPrefixEnabled, setEmailPrefixEnabled] = useState(true);
  const [emailKeywordEnabled, setEmailKeywordEnabled] = useState(true);
  const [emailLlmFallbackEnabled, setEmailLlmFallbackEnabled] = useState(true);

  const [githubBinding, setGithubBinding] = useState<ConnectorBinding | null>(null);
  const [githubDefaultEnvironmentId, setGithubDefaultEnvironmentId] = useState("");
  const [githubAgentId, setGithubAgentId] = useState<string | null>(null);
  const [githubTools, setGithubTools] = useState<TaskToolOptions>(defaultToolOptions);
  const [githubPrefixEnabled, setGithubPrefixEnabled] = useState(true);
  const [githubKeywordEnabled, setGithubKeywordEnabled] = useState(true);
  const [githubLlmFallbackEnabled, setGithubLlmFallbackEnabled] = useState(true);
  const [githubConnector, setGithubConnector] = useState<GitHubConnectorStatusResponse | null>(null);
  const [sharedConnectorStatus, setSharedConnectorStatus] = useState<SharedConnectorStatus | null>(null);
  const [githubDefaultOrgDraft, setGithubDefaultOrgDraft] = useState("");
  const [githubAppConfigJsonDraft, setGithubAppConfigJsonDraft] = useState(buildGitHubAppConfigDraft(null));

  const [pairCodeByConnector, setPairCodeByConnector] = useState<Record<PairableConnectorType, PairCodeState | null>>({
    telegram: null,
    discord: null,
    github: null
  });
  const activeTab = parseConnectorTab(searchParams.get("tab")) ?? "telegram";
  const setActiveTab = useCallback((nextValue: SetStateAction<ConnectorTab>) => {
    setSearchParams((currentParams) => {
      const currentTab = parseConnectorTab(currentParams.get("tab")) ?? "telegram";
      const nextTab = typeof nextValue === "function"
        ? nextValue(currentTab)
        : nextValue;
      if (nextTab === currentTab && currentParams.get("tab") !== null) {
        return currentParams;
      }

      const nextParams = new URLSearchParams(currentParams);
      nextParams.set("tab", nextTab);
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  const { loadConnectors } = useWorkspaceConnectorsLoading({
    api,
    activeWorkspaceId,
    defaultToolOptions,
    workspaceMemoryEnabled,
    searchParams,
    setSearchParams,
    setFlash,
    setIsLoading,
    setLoadError,
    setSaveError,
    setLastSetupWebhookUrl,
    setPairCodeByConnector,
    setTelegramConnector,
    setTelegramConnectionMode,
    setTelegramMode,
    setTelegramAgentId,
    setTelegramTools,
    setTelegramPrefixEnabled,
    setTelegramKeywordEnabled,
    setTelegramLlmFallbackEnabled,
    setDiscordConnector,
    setDiscordConnectionMode,
    setDiscordAgentId,
    setDiscordTools,
    setDiscordPrefixEnabled,
    setDiscordKeywordEnabled,
    setDiscordLlmFallbackEnabled,
    setDiscordChannelHistoryEnabled,
    setDiscordChannelHistoryMaxCharsDraft,
    setDiscordChannelHistoryIncludePinnedMessages,
    setEmailBinding,
    setEmailConnectorStatus,
    setEmailLocalPartDraft,
    setEmailSenderPolicy,
    setEmailTrustedAddressesDraft,
    setEmailAgentId,
    setEmailTools,
    setEmailPrefixEnabled,
    setEmailKeywordEnabled,
    setEmailLlmFallbackEnabled,
    setGithubBinding,
    setGithubConnector,
    setGithubAgentId,
    setGithubTools,
    setGithubPrefixEnabled,
    setGithubKeywordEnabled,
    setGithubLlmFallbackEnabled,
    setSharedConnectorStatus,
    setGithubDefaultOrgDraft,
    setGithubAppConfigJsonDraft,
    setTelegramDefaultEnvironmentId,
    setDiscordDefaultEnvironmentId,
    setEmailDefaultEnvironmentId,
    setGithubDefaultEnvironmentId
  });

  useConnectorDefaultEnvironmentSelection(activeEnvironments, telegramDefaultEnvironmentId, setTelegramDefaultEnvironmentId);
  useConnectorDefaultEnvironmentSelection(activeEnvironments, discordDefaultEnvironmentId, setDiscordDefaultEnvironmentId);
  useConnectorDefaultEnvironmentSelection(activeEnvironments, emailDefaultEnvironmentId, setEmailDefaultEnvironmentId);
  useConnectorDefaultEnvironmentSelection(activeEnvironments, githubDefaultEnvironmentId, setGithubDefaultEnvironmentId);

  const displayedTelegramWebhookUrl =
    lastSetupWebhookUrl ??
    (typeof telegramConnector?.webhookUrl === "string" && telegramConnector.webhookUrl.length > 0
      ? telegramConnector.webhookUrl
      : null);
  const displayedGithubWebhookUrl =
    typeof githubBinding?.webhookUrl === "string" && githubBinding.webhookUrl.length > 0
      ? githubBinding.webhookUrl
      : null;
  const canManageGithub = githubConnector?.canManage ?? activeWorkspaceRole === "owner";
  const canManageConnectors = sharedConnectorStatus?.canManageConnectors ?? activeWorkspaceRole === "owner";
  const githubAppConfigured = githubConnector?.app.configured === true;
  const githubInstallationConnected = githubConnector?.installation.connected === true;
  const sharedTelegramReady =
    sharedConnectorStatus?.telegram.enabled === true && sharedConnectorStatus.telegram.hasToken === true;
  const sharedDiscordReady =
    sharedConnectorStatus?.discord.enabled === true && sharedConnectorStatus.discord.hasToken === true;
  const emailAdminReady =
    emailConnectorStatus?.enabled === true &&
    emailConnectorStatus.admin.enabled &&
    emailConnectorStatus.admin.hasWebhookSecret &&
    emailConnectorStatus.admin.hasBrevoApiKey &&
    typeof emailConnectorStatus.admin.inboundDomain === "string" &&
    emailConnectorStatus.admin.inboundDomain.length > 0;
  const emailAddressMode = emailConnectorStatus?.admin.addressMode ?? sharedConnectorStatus?.email.addressMode ?? "random";
  const displayedEmailAddress =
    emailConnectorStatus?.connector.connected
      ? emailConnectorStatus.connector.emailAddress
      : emailBinding?.config.emailAddress ?? null;

  const actions = useWorkspaceConnectorsActions({
    api,
    activeWorkspaceId,
    capabilities,
    platform,
    setFlash,
    loadConnectors,
    setSaveError,
    setIsSaving,
    setPairCodeByConnector,
    telegramConnectionMode,
    telegramBotToken,
    telegramMode,
    telegramDefaultEnvironmentId,
    telegramAgentId,
    telegramTools,
    telegramPrefixEnabled,
    telegramKeywordEnabled,
    telegramLlmFallbackEnabled,
    sharedTelegramReady,
    setLastSetupWebhookUrl,
    setTelegramBotToken,
    discordConnectionMode,
    discordBotToken,
    discordDefaultEnvironmentId,
    discordAgentId,
    discordTools,
    discordPrefixEnabled,
    discordKeywordEnabled,
    discordLlmFallbackEnabled,
    discordChannelHistoryEnabled,
    discordChannelHistoryMaxCharsDraft,
    discordChannelHistoryIncludePinnedMessages,
    sharedDiscordReady,
    setDiscordBotToken,
    githubInstallationConnected,
    githubDefaultEnvironmentId,
    githubAgentId,
    githubTools,
    githubPrefixEnabled,
    githubKeywordEnabled,
    githubLlmFallbackEnabled,
    canManageGithub,
    githubAppConfigJsonDraft,
    githubDefaultOrgDraft,
    canManageConnectors,
    emailAdminReady,
    emailDefaultEnvironmentId,
    emailAddressMode,
    emailLocalPartDraft,
    emailSenderPolicy,
    emailTrustedAddressesDraft,
    emailAgentId,
    emailTools,
    emailPrefixEnabled,
    emailKeywordEnabled,
    emailLlmFallbackEnabled
  });

  const sources = useWorkspaceSources({
    api,
    activeWorkspaceId,
    capabilities,
    platform,
    searchParams,
    setSearchParams,
    setFlash
  });

  return {
    activeEnvironments,
    availableAgents,
    availableSkills,
    defaultAgentId,
    isLoading,
    isSaving,
    loadError,
    saveError,
    telegramConnector,
    telegramConnectionMode,
    telegramBotToken,
    telegramMode,
    telegramDefaultEnvironmentId,
    telegramAgentId,
    telegramTools,
    telegramPrefixEnabled,
    telegramKeywordEnabled,
    telegramLlmFallbackEnabled,
    discordConnector,
    discordConnectionMode,
    discordBotToken,
    discordDefaultEnvironmentId,
    discordAgentId,
    discordTools,
    discordPrefixEnabled,
    discordKeywordEnabled,
    discordLlmFallbackEnabled,
    discordChannelHistoryEnabled,
    discordChannelHistoryMaxCharsDraft,
    discordChannelHistoryIncludePinnedMessages,
    emailBinding,
    emailConnectorStatus,
    emailLocalPartDraft,
    emailSenderPolicy,
    emailTrustedAddressesDraft,
    emailDefaultEnvironmentId,
    emailAgentId,
    emailTools,
    emailPrefixEnabled,
    emailKeywordEnabled,
    emailLlmFallbackEnabled,
    githubBinding,
    githubDefaultEnvironmentId,
    githubAgentId,
    githubTools,
    githubPrefixEnabled,
    githubKeywordEnabled,
    githubLlmFallbackEnabled,
    githubConnector,
    sharedConnectorStatus,
    githubDefaultOrgDraft,
    githubAppConfigJsonDraft,
    pairCodeByConnector,
    activeTab,
    setActiveTab,
    displayedTelegramWebhookUrl,
    displayedGithubWebhookUrl,
    canManageGithub,
    canManageConnectors,
    githubAppConfigured,
    githubInstallationConnected,
    sharedTelegramReady,
    sharedDiscordReady,
    emailAdminReady,
    emailAddressMode,
    displayedEmailAddress,
    sources: sources.sources,
    sourcesCanManage: sources.canManage,
    sourcesLoading: sources.isLoading,
    sourcesSaving: sources.isSaving,
    sourcesError: sources.error,
    workspaceMemoryEnabled,
    setTelegramConnectionMode,
    setTelegramMode,
    setTelegramBotToken,
    setTelegramDefaultEnvironmentId,
    setTelegramAgentId,
    setTelegramTools,
    setTelegramPrefixEnabled,
    setTelegramKeywordEnabled,
    setTelegramLlmFallbackEnabled,
    setDiscordConnectionMode,
    setDiscordBotToken,
    setDiscordDefaultEnvironmentId,
    setDiscordAgentId,
    setDiscordTools,
    setDiscordPrefixEnabled,
    setDiscordKeywordEnabled,
    setDiscordLlmFallbackEnabled,
    setDiscordChannelHistoryEnabled,
    setDiscordChannelHistoryMaxCharsDraft,
    setDiscordChannelHistoryIncludePinnedMessages,
    setEmailLocalPartDraft,
    setEmailSenderPolicy,
    setEmailTrustedAddressesDraft,
    setEmailDefaultEnvironmentId,
    setEmailAgentId,
    setEmailTools,
    setEmailPrefixEnabled,
    setEmailKeywordEnabled,
    setEmailLlmFallbackEnabled,
    setGithubDefaultEnvironmentId,
    setGithubAgentId,
    setGithubTools,
    setGithubPrefixEnabled,
    setGithubKeywordEnabled,
    setGithubLlmFallbackEnabled,
    setGithubDefaultOrgDraft,
    setGithubAppConfigJsonDraft,
    loadConnectors,
    loadSources: sources.loadSources,
    handleSourceConnect: sources.handleConnect,
    handleSourceDisconnect: sources.handleDisconnect,
    handleSourceConfigureRclone: sources.handleConfigureRclone,
    ...actions
  };
}
