import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import type { ApiClient } from "../../../lib/api";
import type { FlashMessage, TaskToolOptions } from "../../../lib/types";
import type { PairCodeState } from "../../../components/connectors/ConnectorSettingsSections";
import { normalizeToolOptions } from "../../../task/taskInputDrafts";
import type {
  ConnectorBinding,
  EmailConnectorStatusResponse,
  GitHubConnectorStatusResponse,
  PairableConnectorType,
  SharedConnectorStatus,
  WorkspaceConnectorListResponse
} from "./workspaceConnectorsTypes";
import { buildGitHubAppConfigDraft } from "./workspaceConnectorsUtils";

interface LoadingState {
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setLoadError: Dispatch<SetStateAction<string | null>>;
  setSaveError: Dispatch<SetStateAction<string | null>>;
  setLastSetupWebhookUrl: Dispatch<SetStateAction<string | null>>;
  setPairCodeByConnector: Dispatch<SetStateAction<Record<PairableConnectorType, PairCodeState | null>>>;
  setTelegramConnector: Dispatch<SetStateAction<ConnectorBinding | null>>;
  setTelegramConnectionMode: Dispatch<SetStateAction<"custom" | "shared">>;
  setTelegramMode: Dispatch<SetStateAction<"webhook" | "polling">>;
  setTelegramAgentId: Dispatch<SetStateAction<string | null>>;
  setTelegramTools: Dispatch<SetStateAction<TaskToolOptions>>;
  setTelegramPrefixEnabled: Dispatch<SetStateAction<boolean>>;
  setTelegramKeywordEnabled: Dispatch<SetStateAction<boolean>>;
  setTelegramLlmFallbackEnabled: Dispatch<SetStateAction<boolean>>;
  setDiscordConnector: Dispatch<SetStateAction<ConnectorBinding | null>>;
  setDiscordConnectionMode: Dispatch<SetStateAction<"custom" | "shared">>;
  setDiscordAgentId: Dispatch<SetStateAction<string | null>>;
  setDiscordTools: Dispatch<SetStateAction<TaskToolOptions>>;
  setDiscordPrefixEnabled: Dispatch<SetStateAction<boolean>>;
  setDiscordKeywordEnabled: Dispatch<SetStateAction<boolean>>;
  setDiscordLlmFallbackEnabled: Dispatch<SetStateAction<boolean>>;
  setDiscordChannelHistoryEnabled: Dispatch<SetStateAction<boolean>>;
  setDiscordChannelHistoryMaxCharsDraft: Dispatch<SetStateAction<string>>;
  setDiscordChannelHistoryIncludePinnedMessages: Dispatch<SetStateAction<boolean>>;
  setEmailBinding: Dispatch<SetStateAction<ConnectorBinding | null>>;
  setEmailConnectorStatus: Dispatch<SetStateAction<EmailConnectorStatusResponse | null>>;
  setEmailLocalPartDraft: Dispatch<SetStateAction<string>>;
  setEmailSenderPolicy: Dispatch<SetStateAction<"allow_any" | "trusted_only">>;
  setEmailTrustedAddressesDraft: Dispatch<SetStateAction<string>>;
  setEmailAgentId: Dispatch<SetStateAction<string | null>>;
  setEmailTools: Dispatch<SetStateAction<TaskToolOptions>>;
  setEmailPrefixEnabled: Dispatch<SetStateAction<boolean>>;
  setEmailKeywordEnabled: Dispatch<SetStateAction<boolean>>;
  setEmailLlmFallbackEnabled: Dispatch<SetStateAction<boolean>>;
  setGithubBinding: Dispatch<SetStateAction<ConnectorBinding | null>>;
  setGithubConnector: Dispatch<SetStateAction<GitHubConnectorStatusResponse | null>>;
  setGithubAgentId: Dispatch<SetStateAction<string | null>>;
  setGithubTools: Dispatch<SetStateAction<TaskToolOptions>>;
  setGithubPrefixEnabled: Dispatch<SetStateAction<boolean>>;
  setGithubKeywordEnabled: Dispatch<SetStateAction<boolean>>;
  setGithubLlmFallbackEnabled: Dispatch<SetStateAction<boolean>>;
  setSharedConnectorStatus: Dispatch<SetStateAction<SharedConnectorStatus | null>>;
  setGithubDefaultOrgDraft: Dispatch<SetStateAction<string>>;
  setGithubAppConfigJsonDraft: Dispatch<SetStateAction<string>>;
  setTelegramDefaultEnvironmentId: Dispatch<SetStateAction<string>>;
  setDiscordDefaultEnvironmentId: Dispatch<SetStateAction<string>>;
  setEmailDefaultEnvironmentId: Dispatch<SetStateAction<string>>;
  setGithubDefaultEnvironmentId: Dispatch<SetStateAction<string>>;
}

interface UseWorkspaceConnectorsLoadingInput extends LoadingState {
  api: ApiClient;
  activeWorkspaceId: string;
  defaultToolOptions: TaskToolOptions;
  workspaceMemoryEnabled: boolean;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  setFlash: (flash: FlashMessage | null) => void;
}

function createLoadingState(input: UseWorkspaceConnectorsLoadingInput): LoadingState {
  return {
    setIsLoading: input.setIsLoading,
    setLoadError: input.setLoadError,
    setSaveError: input.setSaveError,
    setLastSetupWebhookUrl: input.setLastSetupWebhookUrl,
    setPairCodeByConnector: input.setPairCodeByConnector,
    setTelegramConnector: input.setTelegramConnector,
    setTelegramConnectionMode: input.setTelegramConnectionMode,
    setTelegramMode: input.setTelegramMode,
    setTelegramAgentId: input.setTelegramAgentId,
    setTelegramTools: input.setTelegramTools,
    setTelegramPrefixEnabled: input.setTelegramPrefixEnabled,
    setTelegramKeywordEnabled: input.setTelegramKeywordEnabled,
    setTelegramLlmFallbackEnabled: input.setTelegramLlmFallbackEnabled,
    setDiscordConnector: input.setDiscordConnector,
    setDiscordConnectionMode: input.setDiscordConnectionMode,
    setDiscordAgentId: input.setDiscordAgentId,
    setDiscordTools: input.setDiscordTools,
    setDiscordPrefixEnabled: input.setDiscordPrefixEnabled,
    setDiscordKeywordEnabled: input.setDiscordKeywordEnabled,
    setDiscordLlmFallbackEnabled: input.setDiscordLlmFallbackEnabled,
    setDiscordChannelHistoryEnabled: input.setDiscordChannelHistoryEnabled,
    setDiscordChannelHistoryMaxCharsDraft: input.setDiscordChannelHistoryMaxCharsDraft,
    setDiscordChannelHistoryIncludePinnedMessages: input.setDiscordChannelHistoryIncludePinnedMessages,
    setEmailBinding: input.setEmailBinding,
    setEmailConnectorStatus: input.setEmailConnectorStatus,
    setEmailLocalPartDraft: input.setEmailLocalPartDraft,
    setEmailSenderPolicy: input.setEmailSenderPolicy,
    setEmailTrustedAddressesDraft: input.setEmailTrustedAddressesDraft,
    setEmailAgentId: input.setEmailAgentId,
    setEmailTools: input.setEmailTools,
    setEmailPrefixEnabled: input.setEmailPrefixEnabled,
    setEmailKeywordEnabled: input.setEmailKeywordEnabled,
    setEmailLlmFallbackEnabled: input.setEmailLlmFallbackEnabled,
    setGithubBinding: input.setGithubBinding,
    setGithubConnector: input.setGithubConnector,
    setGithubAgentId: input.setGithubAgentId,
    setGithubTools: input.setGithubTools,
    setGithubPrefixEnabled: input.setGithubPrefixEnabled,
    setGithubKeywordEnabled: input.setGithubKeywordEnabled,
    setGithubLlmFallbackEnabled: input.setGithubLlmFallbackEnabled,
    setSharedConnectorStatus: input.setSharedConnectorStatus,
    setGithubDefaultOrgDraft: input.setGithubDefaultOrgDraft,
    setGithubAppConfigJsonDraft: input.setGithubAppConfigJsonDraft,
    setTelegramDefaultEnvironmentId: input.setTelegramDefaultEnvironmentId,
    setDiscordDefaultEnvironmentId: input.setDiscordDefaultEnvironmentId,
    setEmailDefaultEnvironmentId: input.setEmailDefaultEnvironmentId,
    setGithubDefaultEnvironmentId: input.setGithubDefaultEnvironmentId
  };
}

function resetConnectorState(input: { state: LoadingState; defaultToolOptions: TaskToolOptions }): void {
  input.state.setLastSetupWebhookUrl(null);
  input.state.setPairCodeByConnector({ telegram: null, discord: null, github: null });
  input.state.setEmailBinding(null);
  input.state.setEmailConnectorStatus(null);
  input.state.setEmailLocalPartDraft("");
  input.state.setEmailSenderPolicy("allow_any");
  input.state.setEmailTrustedAddressesDraft("");
  input.state.setEmailDefaultEnvironmentId("");
  input.state.setEmailAgentId(null);
  input.state.setEmailTools(input.defaultToolOptions);
  input.state.setEmailPrefixEnabled(true);
  input.state.setEmailKeywordEnabled(true);
  input.state.setEmailLlmFallbackEnabled(true);
  input.state.setGithubBinding(null);
  input.state.setGithubConnector(null);
  input.state.setGithubDefaultEnvironmentId("");
  input.state.setGithubAgentId(null);
  input.state.setGithubTools(input.defaultToolOptions);
  input.state.setGithubPrefixEnabled(true);
  input.state.setGithubKeywordEnabled(true);
  input.state.setGithubLlmFallbackEnabled(true);
  input.state.setGithubDefaultOrgDraft("");
  input.state.setGithubAppConfigJsonDraft(buildGitHubAppConfigDraft(null));
  input.state.setSharedConnectorStatus(null);
  input.state.setTelegramConnectionMode("custom");
  input.state.setTelegramAgentId(null);
  input.state.setTelegramTools(input.defaultToolOptions);
  input.state.setDiscordConnectionMode("custom");
  input.state.setDiscordAgentId(null);
  input.state.setDiscordTools(input.defaultToolOptions);
}

function clearConnectorLoadState(input: { state: LoadingState; defaultToolOptions: TaskToolOptions }): void {
  input.state.setTelegramConnector(null);
  input.state.setDiscordConnector(null);
  input.state.setEmailBinding(null);
  input.state.setEmailConnectorStatus(null);
  input.state.setGithubBinding(null);
  input.state.setGithubConnector(null);
  input.state.setSharedConnectorStatus(null);
  input.state.setTelegramAgentId(null);
  input.state.setTelegramTools(input.defaultToolOptions);
  input.state.setDiscordAgentId(null);
  input.state.setDiscordTools(input.defaultToolOptions);
  input.state.setEmailAgentId(null);
  input.state.setEmailTools(input.defaultToolOptions);
  input.state.setGithubAgentId(null);
  input.state.setGithubTools(input.defaultToolOptions);
  input.state.setGithubDefaultOrgDraft("");
}

function buildGithubAppConfigJsonDraft(githubStatus: GitHubConnectorStatusResponse): string {
  if (!githubStatus.app.configured) {
    return buildGitHubAppConfigDraft(null);
  }

  return JSON.stringify(
    {
      appId: githubStatus.app.appId,
      appSlug: githubStatus.app.appSlug,
      privateKeyPem: "<paste-private-key-pem-with-\\n-line-breaks>",
      webhookSecret: "<paste-webhook-secret>",
      clientId: githubStatus.app.hasClientId ? "<already configured (optional)>" : null,
      clientSecret: githubStatus.app.hasClientSecret ? "<already configured (optional)>" : null,
      defaultOrg: githubStatus.app.defaultOrg
    },
    null,
    2
  );
}

function applyTelegramConnectorState(input: {
  state: LoadingState;
  connector: ConnectorBinding | null;
  defaultToolOptions: TaskToolOptions;
  workspaceMemoryEnabled: boolean;
}): void {
  const { connector, defaultToolOptions, state, workspaceMemoryEnabled } = input;
  if (!connector) {
    state.setTelegramAgentId(null);
    state.setTelegramTools(defaultToolOptions);
    state.setTelegramConnectionMode("custom");
    state.setTelegramMode("webhook");
    state.setTelegramPrefixEnabled(true);
    state.setTelegramKeywordEnabled(true);
    state.setTelegramLlmFallbackEnabled(true);
    return;
  }

  state.setTelegramConnectionMode(connector.config.connectionMode === "shared" ? "shared" : "custom");
  state.setTelegramMode(connector.config.mode === "polling" ? "polling" : "webhook");
  const configuredEnvironmentId =
    typeof connector.config.defaultEnvironmentId === "string"
      ? connector.config.defaultEnvironmentId
      : "";
  if (configuredEnvironmentId) {
    state.setTelegramDefaultEnvironmentId(configuredEnvironmentId);
  }
  state.setTelegramAgentId(connector.config.agentId ?? null);
  state.setTelegramTools(normalizeToolOptions(connector.config.tools, { memorySearch: workspaceMemoryEnabled }));
  state.setTelegramPrefixEnabled(connector.config.prefixEnabled !== false);
  state.setTelegramKeywordEnabled(connector.config.keywordEnabled !== false);
  state.setTelegramLlmFallbackEnabled(connector.config.llmFallbackEnabled !== false);
}

function applyDiscordConnectorState(input: {
  state: LoadingState;
  connector: ConnectorBinding | null;
  defaultToolOptions: TaskToolOptions;
  workspaceMemoryEnabled: boolean;
}): void {
  const { connector, defaultToolOptions, state, workspaceMemoryEnabled } = input;
  if (!connector) {
    state.setDiscordConnectionMode("custom");
    state.setDiscordAgentId(null);
    state.setDiscordTools(defaultToolOptions);
    state.setDiscordPrefixEnabled(true);
    state.setDiscordKeywordEnabled(true);
    state.setDiscordLlmFallbackEnabled(true);
    state.setDiscordChannelHistoryEnabled(false);
    state.setDiscordChannelHistoryMaxCharsDraft("");
    state.setDiscordChannelHistoryIncludePinnedMessages(true);
    return;
  }

  state.setDiscordConnectionMode(connector.config.connectionMode === "shared" ? "shared" : "custom");
  const configuredEnvironmentId =
    typeof connector.config.defaultEnvironmentId === "string"
      ? connector.config.defaultEnvironmentId
      : "";
  if (configuredEnvironmentId) {
    state.setDiscordDefaultEnvironmentId(configuredEnvironmentId);
  }
  state.setDiscordAgentId(connector.config.agentId ?? null);
  state.setDiscordTools(normalizeToolOptions(connector.config.tools, { memorySearch: workspaceMemoryEnabled }));
  state.setDiscordPrefixEnabled(connector.config.prefixEnabled !== false);
  state.setDiscordKeywordEnabled(connector.config.keywordEnabled !== false);
  state.setDiscordLlmFallbackEnabled(connector.config.llmFallbackEnabled !== false);
  state.setDiscordChannelHistoryEnabled(connector.config.channelHistoryEnabled === true);
  const configuredHistoryMaxChars =
    typeof connector.config.channelHistoryMaxChars === "number"
    && Number.isFinite(connector.config.channelHistoryMaxChars)
    && connector.config.channelHistoryMaxChars > 0
      ? Math.floor(connector.config.channelHistoryMaxChars)
      : null;
  state.setDiscordChannelHistoryMaxCharsDraft(configuredHistoryMaxChars !== null ? String(configuredHistoryMaxChars) : "");
  state.setDiscordChannelHistoryIncludePinnedMessages(connector.config.channelHistoryIncludePinnedMessages !== false);
}

function applyEmailConnectorState(input: {
  state: LoadingState;
  binding: ConnectorBinding | null;
  status: EmailConnectorStatusResponse;
  workspaceMemoryEnabled: boolean;
}): void {
  const { binding, state, status, workspaceMemoryEnabled } = input;
  if (status.connector.connected) {
    state.setEmailLocalPartDraft(status.connector.localPart);
    state.setEmailSenderPolicy(status.connector.senderPolicy);
    state.setEmailTrustedAddressesDraft(status.connector.trustedSenders.join(", "));
    state.setEmailDefaultEnvironmentId(status.connector.defaultEnvironmentId ?? "");
    state.setEmailAgentId(status.connector.agentId ?? null);
    state.setEmailTools(normalizeToolOptions(status.connector.tools, { memorySearch: workspaceMemoryEnabled }));
    state.setEmailPrefixEnabled(status.connector.prefixEnabled);
    state.setEmailKeywordEnabled(status.connector.keywordEnabled);
    state.setEmailLlmFallbackEnabled(status.connector.llmFallbackEnabled);
    return;
  }

  state.setEmailLocalPartDraft(binding?.config.localPart ?? "");
  state.setEmailSenderPolicy(binding?.config.senderPolicy === "trusted_only" ? "trusted_only" : "allow_any");
  state.setEmailTrustedAddressesDraft((binding?.config.trustedSenders ?? []).join(", "));
  state.setEmailDefaultEnvironmentId(
    typeof binding?.config.defaultEnvironmentId === "string"
      ? binding.config.defaultEnvironmentId
      : ""
  );
  state.setEmailAgentId(binding?.config.agentId ?? null);
  state.setEmailTools(normalizeToolOptions(binding?.config.tools, { memorySearch: workspaceMemoryEnabled }));
  state.setEmailPrefixEnabled(binding?.config.prefixEnabled !== false);
  state.setEmailKeywordEnabled(binding?.config.keywordEnabled !== false);
  state.setEmailLlmFallbackEnabled(binding?.config.llmFallbackEnabled !== false);
}

function applyGithubConnectorState(input: {
  state: LoadingState;
  connector: ConnectorBinding | null;
  defaultToolOptions: TaskToolOptions;
  workspaceMemoryEnabled: boolean;
}): void {
  const { connector, defaultToolOptions, state, workspaceMemoryEnabled } = input;
  if (!connector) {
    state.setGithubAgentId(null);
    state.setGithubTools(defaultToolOptions);
    state.setGithubPrefixEnabled(true);
    state.setGithubKeywordEnabled(true);
    state.setGithubLlmFallbackEnabled(true);
    return;
  }

  const configuredEnvironmentId =
    typeof connector.config.defaultEnvironmentId === "string"
      ? connector.config.defaultEnvironmentId
      : "";
  if (configuredEnvironmentId) {
    state.setGithubDefaultEnvironmentId(configuredEnvironmentId);
  }
  state.setGithubAgentId(connector.config.agentId ?? null);
  state.setGithubTools(normalizeToolOptions(connector.config.tools, { memorySearch: workspaceMemoryEnabled }));
  state.setGithubPrefixEnabled(connector.config.prefixEnabled !== false);
  state.setGithubKeywordEnabled(connector.config.keywordEnabled !== false);
  state.setGithubLlmFallbackEnabled(connector.config.llmFallbackEnabled !== false);
}

function applyLoadedConnectorState(input: {
  state: LoadingState;
  response: WorkspaceConnectorListResponse;
  githubStatus: GitHubConnectorStatusResponse;
  emailStatus: EmailConnectorStatusResponse;
  defaultToolOptions: TaskToolOptions;
  workspaceMemoryEnabled: boolean;
}): void {
  const { defaultToolOptions, emailStatus, githubStatus, response, state, workspaceMemoryEnabled } = input;
  const telegramConnector = response.items.find((item) => item.type === "telegram") ?? null;
  const discordConnector = response.items.find((item) => item.type === "discord") ?? null;
  const emailBinding = response.items.find((item) => item.type === "email") ?? null;
  const githubBinding = response.items.find((item) => item.type === "github") ?? null;

  state.setTelegramConnector(telegramConnector);
  state.setDiscordConnector(discordConnector);
  state.setEmailBinding(emailBinding);
  state.setEmailConnectorStatus(emailStatus);
  state.setGithubBinding(githubBinding);
  state.setGithubConnector(githubStatus);
  state.setSharedConnectorStatus(response.shared);
  state.setGithubDefaultOrgDraft(githubStatus.app.configured ? (githubStatus.app.defaultOrg ?? "") : "");
  state.setGithubAppConfigJsonDraft(buildGithubAppConfigJsonDraft(githubStatus));

  applyTelegramConnectorState({
    state,
    connector: telegramConnector,
    defaultToolOptions,
    workspaceMemoryEnabled
  });
  applyDiscordConnectorState({
    state,
    connector: discordConnector,
    defaultToolOptions,
    workspaceMemoryEnabled
  });
  applyEmailConnectorState({
    state,
    binding: emailBinding,
    status: emailStatus,
    workspaceMemoryEnabled
  });
  applyGithubConnectorState({
    state,
    connector: githubBinding,
    defaultToolOptions,
    workspaceMemoryEnabled
  });
}

function handleConnectorLoadError(input: { state: LoadingState; error: unknown }): void {
  input.state.setEmailBinding(null);
  input.state.setEmailConnectorStatus(null);
  input.state.setGithubBinding(null);
  input.state.setGithubConnector(null);
  input.state.setSharedConnectorStatus(null);
  input.state.setLoadError(input.error instanceof Error ? input.error.message : String(input.error));
}

async function fetchWorkspaceConnectorData(input: {
  activeWorkspaceId: string;
  api: ApiClient;
}): Promise<{
  response: WorkspaceConnectorListResponse;
  githubStatus: GitHubConnectorStatusResponse;
  emailStatus: EmailConnectorStatusResponse;
}> {
  const { activeWorkspaceId, api } = input;
  const [response, githubStatus, emailStatus] = await Promise.all([
    api.get<WorkspaceConnectorListResponse>(`/api/workspaces/${activeWorkspaceId}/connectors`),
    api.get<GitHubConnectorStatusResponse>(`/api/workspaces/${activeWorkspaceId}/connectors/github`),
    api.get<EmailConnectorStatusResponse>(`/api/workspaces/${activeWorkspaceId}/connectors/email`)
  ]);

  return {
    response,
    githubStatus,
    emailStatus
  };
}

export function useWorkspaceConnectorsLoading(input: UseWorkspaceConnectorsLoadingInput) {
  const state = createLoadingState(input);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { activeWorkspaceId, api, defaultToolOptions, searchParams, setFlash, setSearchParams, workspaceMemoryEnabled } = input;
  const githubInstallStatus = searchParams.get("github_install");

  const loadConnectors = useCallback(async () => {
    const latestState = stateRef.current;
    if (!activeWorkspaceId) {
      clearConnectorLoadState({ state: latestState, defaultToolOptions });
      latestState.setIsLoading(false);
      return;
    }

    latestState.setIsLoading(true);
    latestState.setLoadError(null);

    try {
      const loadedData = await fetchWorkspaceConnectorData({ api, activeWorkspaceId });
      applyLoadedConnectorState({
        state: latestState,
        response: loadedData.response,
        githubStatus: loadedData.githubStatus,
        emailStatus: loadedData.emailStatus,
        defaultToolOptions,
        workspaceMemoryEnabled
      });
    } catch (error) {
      handleConnectorLoadError({ state: latestState, error });
    } finally {
      latestState.setIsLoading(false);
    }
  }, [activeWorkspaceId, api, defaultToolOptions, workspaceMemoryEnabled]);

  useEffect(() => {
    resetConnectorState({ state: stateRef.current, defaultToolOptions });
  }, [activeWorkspaceId, defaultToolOptions]);

  useEffect(() => {
    loadConnectors().catch(() => undefined);
  }, [loadConnectors]);

  useEffect(() => {
    if (!githubInstallStatus) {
      return;
    }

    setFlash({
      tone: githubInstallStatus === "success" ? "success" : "error",
      text:
        githubInstallStatus === "success"
          ? "GitHub App installation connected for this workspace."
          : "GitHub App installation was cancelled or failed."
    });

    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);
      nextParams.delete("github_install");
      return nextParams;
    }, { replace: true });
    loadConnectors().catch(() => undefined);
  }, [githubInstallStatus, loadConnectors, setFlash, setSearchParams]);

  return { loadConnectors };
}
