import type { FormEvent } from "react";
import { useCallback } from "react";
import type { ApiClient } from "../../../lib/api";
import type { FlashMessage, TaskToolOptions } from "../../../lib/types";
import { desktopGithubReturnOrigin } from "../../../desktop/platform";
import type { PairCodeState } from "../../../components/connectors/ConnectorSettingsSections";
import type {
  ConnectorPairCodeResponse,
  DiscordSetupResponse,
  EmailConnectorSetupResponse,
  GitHubExistingInstallResponse,
  GitHubConnectorSetupResponse,
  GitHubInstallStartResponse,
  PairableConnectorType,
  TelegramSetupResponse
} from "./workspaceConnectorsTypes";

interface UseWorkspaceConnectorsActionsInput {
  api: ApiClient;
  activeWorkspaceId: string;
  capabilities: { isDesktop: boolean };
  platform: { openExternal: (url: string) => Promise<void> };
  setFlash: (flash: FlashMessage | null) => void;
  loadConnectors: () => Promise<void>;
  setSaveError: (value: string | null) => void;
  setIsSaving: (value: boolean) => void;
  setPairCodeByConnector: React.Dispatch<React.SetStateAction<Record<PairableConnectorType, PairCodeState | null>>>;
  telegramConnectionMode: "custom" | "shared";
  telegramBotToken: string;
  telegramMode: "webhook" | "polling";
  telegramDefaultEnvironmentId: string;
  telegramAgentId: string | null;
  telegramTools: TaskToolOptions;
  telegramPrefixEnabled: boolean;
  telegramKeywordEnabled: boolean;
  telegramLlmFallbackEnabled: boolean;
  sharedTelegramReady: boolean;
  setLastSetupWebhookUrl: (value: string | null) => void;
  setTelegramBotToken: (value: string) => void;
  discordConnectionMode: "custom" | "shared";
  discordBotToken: string;
  discordDefaultEnvironmentId: string;
  discordAgentId: string | null;
  discordTools: TaskToolOptions;
  discordPrefixEnabled: boolean;
  discordKeywordEnabled: boolean;
  discordLlmFallbackEnabled: boolean;
  discordChannelHistoryEnabled: boolean;
  discordChannelHistoryMaxCharsDraft: string;
  discordChannelHistoryIncludePinnedMessages: boolean;
  sharedDiscordReady: boolean;
  setDiscordBotToken: (value: string) => void;
  githubInstallationConnected: boolean;
  githubDefaultEnvironmentId: string;
  githubAgentId: string | null;
  githubTools: TaskToolOptions;
  githubPrefixEnabled: boolean;
  githubKeywordEnabled: boolean;
  githubLlmFallbackEnabled: boolean;
  canManageGithub: boolean;
  githubAppConfigJsonDraft: string;
  githubDefaultOrgDraft: string;
  canManageConnectors: boolean;
  emailAdminReady: boolean;
  emailDefaultEnvironmentId: string;
  emailAddressMode: string;
  emailLocalPartDraft: string;
  emailSenderPolicy: "allow_any" | "trusted_only";
  emailTrustedAddressesDraft: string;
  emailAgentId: string | null;
  emailTools: TaskToolOptions;
  emailPrefixEnabled: boolean;
  emailKeywordEnabled: boolean;
  emailLlmFallbackEnabled: boolean;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useWorkspaceConnectorsActions(input: UseWorkspaceConnectorsActionsInput) {
  const handlePairCodeIssue = useCallback(async (connectorType: PairableConnectorType): Promise<void> => {
    if (!input.activeWorkspaceId) {
      return;
    }

    input.setSaveError(null);
    input.setIsSaving(true);
    try {
      const response = await input.api.post<ConnectorPairCodeResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/connectors/${connectorType}/pair`,
        {}
      );
      input.setPairCodeByConnector((previous) => ({
        ...previous,
        [connectorType]: {
          code: response.code,
          expiresAt: response.expiresAt,
          instructions: response.instructions
        }
      }));
      await input.loadConnectors();
      const connectorLabel = connectorType === "telegram" ? "Telegram" : connectorType === "discord" ? "Discord" : "GitHub";
      input.setFlash({ tone: "success", text: `${connectorLabel} pair code generated. Send it from the account you want to authorize.` });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleTelegramSetup = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    input.setSaveError(null);
    const trimmedToken = input.telegramBotToken.trim();
    if (input.telegramConnectionMode === "custom" && !trimmedToken) {
      input.setSaveError("Enter your Telegram bot token.");
      return;
    }
    if (input.telegramConnectionMode === "shared" && !input.sharedTelegramReady) {
      input.setSaveError("Shared Telegram bot is not enabled by the platform admin yet.");
      return;
    }
    if (!input.telegramDefaultEnvironmentId) {
      input.setSaveError("Choose a default project first.");
      return;
    }

    input.setIsSaving(true);
    try {
      const setupResult = await input.api.post<TelegramSetupResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/connectors/telegram`,
        {
          connectionMode: input.telegramConnectionMode,
          botToken: input.telegramConnectionMode === "custom" ? trimmedToken : undefined,
          mode: input.telegramMode,
          defaultEnvironmentId: input.telegramDefaultEnvironmentId,
          agentId: input.telegramAgentId,
          tools: input.telegramTools,
          prefixEnabled: input.telegramPrefixEnabled,
          keywordEnabled: input.telegramKeywordEnabled,
          llmFallbackEnabled: input.telegramLlmFallbackEnabled
        }
      );
      const botIdentity = setupResult.bot?.username ? `@${setupResult.bot.username}` : setupResult.bot?.firstName ?? "bot";
      input.setLastSetupWebhookUrl(setupResult.webhookUrl);
      input.setTelegramBotToken("");
      await input.loadConnectors();
      input.setFlash({
        tone: "success",
        text:
          input.telegramConnectionMode === "shared"
            ? "Telegram shared bot mode is enabled for this workspace."
            : `Telegram connector is ready for ${botIdentity} in ${setupResult.mode} mode.`
      });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleDiscordSetup = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    input.setSaveError(null);
    const trimmedToken = input.discordBotToken.trim();
    if (input.discordConnectionMode === "custom" && !trimmedToken) {
      input.setSaveError("Enter your Discord bot token.");
      return;
    }
    if (input.discordConnectionMode === "shared" && !input.sharedDiscordReady) {
      input.setSaveError("Shared Discord bot is not enabled by the platform admin yet.");
      return;
    }
    if (!input.discordDefaultEnvironmentId) {
      input.setSaveError("Choose a default project first.");
      return;
    }

    const trimmedHistoryMaxChars = input.discordChannelHistoryMaxCharsDraft.trim();
    let channelHistoryMaxChars: number | undefined;
    if (trimmedHistoryMaxChars.length > 0) {
      const parsed = Number.parseInt(trimmedHistoryMaxChars, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        input.setSaveError("Discord channel history max chars must be a positive integer.");
        return;
      }
      channelHistoryMaxChars = parsed;
    }

    input.setIsSaving(true);
    try {
      const setupResult = await input.api.post<DiscordSetupResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/connectors/discord`,
        {
          connectionMode: input.discordConnectionMode,
          botToken: input.discordConnectionMode === "custom" ? trimmedToken : undefined,
          defaultEnvironmentId: input.discordDefaultEnvironmentId,
          agentId: input.discordAgentId,
          tools: input.discordTools,
          prefixEnabled: input.discordPrefixEnabled,
          keywordEnabled: input.discordKeywordEnabled,
          llmFallbackEnabled: input.discordLlmFallbackEnabled,
          channelHistoryEnabled: input.discordChannelHistoryEnabled,
          channelHistoryMaxChars,
          channelHistoryIncludePinnedMessages: input.discordChannelHistoryIncludePinnedMessages
        }
      );
      const botIdentity = setupResult.bot.username ? `@${setupResult.bot.username}` : setupResult.bot.globalName ?? "bot";
      input.setDiscordBotToken("");
      await input.loadConnectors();
      input.setFlash({
        tone: "success",
        text:
          input.discordConnectionMode === "shared"
            ? "Discord shared bot mode is enabled for this workspace."
            : `Discord connector is ready for ${botIdentity} in ${setupResult.mode} mode.`
      });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleGitHubConnectorSetup = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!input.activeWorkspaceId) {
      return;
    }
    input.setSaveError(null);
    if (!input.githubInstallationConnected) {
      input.setSaveError("Install the GitHub App first.");
      return;
    }
    if (!input.githubDefaultEnvironmentId) {
      input.setSaveError("Choose a default project first.");
      return;
    }

    input.setIsSaving(true);
    try {
      const setupResult = await input.api.post<GitHubConnectorSetupResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/connectors/github`,
        {
          defaultEnvironmentId: input.githubDefaultEnvironmentId,
          agentId: input.githubAgentId,
          tools: input.githubTools,
          prefixEnabled: input.githubPrefixEnabled,
          keywordEnabled: input.githubKeywordEnabled,
          llmFallbackEnabled: input.githubLlmFallbackEnabled
        }
      );
      await input.loadConnectors();
      input.setFlash({ tone: "success", text: `GitHub connector is ready for @${setupResult.mentionLogin}. Mention this user in issues/PRs to create tasks.` });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleEmailSetup = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!input.activeWorkspaceId) {
      return;
    }
    input.setSaveError(null);
    if (!input.emailAdminReady) {
      input.setSaveError("Email inbound is not fully configured by the platform admin yet.");
      return;
    }
    if (!input.emailDefaultEnvironmentId) {
      input.setSaveError("Choose a default project first.");
      return;
    }

    const trimmedLocalPart = input.emailLocalPartDraft.trim();
    if (input.emailAddressMode === "workspace_custom" && trimmedLocalPart.length === 0) {
      input.setSaveError("Enter an email local-part for this workspace.");
      return;
    }
    if (input.emailSenderPolicy === "trusted_only") {
      const trustedAddresses = input.emailTrustedAddressesDraft.split(",").map((value) => value.trim()).filter(Boolean);
      if (trustedAddresses.length === 0) {
        input.setSaveError("Trusted sender mode requires at least one trusted address.");
        return;
      }
    }

    input.setIsSaving(true);
    try {
      const setupResult = await input.api.post<EmailConnectorSetupResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/connectors/email`,
        {
          localPart: input.emailAddressMode === "workspace_custom" ? trimmedLocalPart : null,
          senderPolicy: input.emailSenderPolicy,
          trustedAddresses: input.emailTrustedAddressesDraft,
          defaultEnvironmentId: input.emailDefaultEnvironmentId,
          agentId: input.emailAgentId,
          tools: input.emailTools,
          prefixEnabled: input.emailPrefixEnabled,
          keywordEnabled: input.emailKeywordEnabled,
          llmFallbackEnabled: input.emailLlmFallbackEnabled
        }
      );
      await input.loadConnectors();
      input.setFlash({ tone: "success", text: setupResult.emailAddress ? `Email connector is ready at ${setupResult.emailAddress}.` : "Email connector is ready for this workspace." });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleEmailDisconnect = useCallback(async (): Promise<void> => {
    if (!input.activeWorkspaceId || !input.canManageConnectors || !window.confirm("Disconnect email connector for this workspace?")) {
      return;
    }
    input.setSaveError(null);
    input.setIsSaving(true);
    try {
      await input.api.delete(`/api/workspaces/${input.activeWorkspaceId}/connectors/email`);
      await input.loadConnectors();
      input.setFlash({ tone: "success", text: "Email connector disconnected for this workspace." });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleGitHubConnect = useCallback(async (): Promise<void> => {
    if (!input.activeWorkspaceId) {
      return;
    }
    input.setSaveError(null);
    input.setIsSaving(true);
    try {
      const response = await input.api.post<GitHubInstallStartResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/connectors/github/install/start`,
        {
          returnOrigin: input.capabilities.isDesktop ? desktopGithubReturnOrigin() : window.location.origin
        }
      );
      if (input.capabilities.isDesktop) {
        await input.platform.openExternal(response.installUrl);
        input.setFlash({ tone: "success", text: "GitHub opened in your browser. Finish the install there, then return here and refresh." });
        return;
      }
      window.location.assign(response.installUrl);
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleGitHubConnectExisting = useCallback(async (): Promise<void> => {
    if (!input.activeWorkspaceId || !input.canManageGithub) {
      return;
    }
    input.setSaveError(null);
    input.setIsSaving(true);
    try {
      const response = await input.api.post<GitHubExistingInstallResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/connectors/github/install/existing`,
        {}
      );
      await input.loadConnectors();
      const accountLabel = response.installation.accountLogin
        ? ` for ${response.installation.accountLogin}`
        : "";
      input.setFlash({ tone: "success", text: `Existing GitHub App installation connected${accountLabel}.` });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleGitHubAppConfigSave = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!input.activeWorkspaceId || !input.canManageGithub) {
      return;
    }
    input.setSaveError(null);
    input.setIsSaving(true);
    try {
      await input.api.put(`/api/workspaces/${input.activeWorkspaceId}/connectors/github/app`, { configJson: input.githubAppConfigJsonDraft });
      await input.loadConnectors();
      input.setFlash({ tone: "success", text: "GitHub App configuration saved." });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleGitHubDefaultOrgSave = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!input.activeWorkspaceId || !input.canManageGithub) {
      return;
    }
    input.setSaveError(null);
    input.setIsSaving(true);
    try {
      const trimmedDefaultOrg = input.githubDefaultOrgDraft.trim();
      await input.api.patch(`/api/workspaces/${input.activeWorkspaceId}/connectors/github`, {
        defaultOrg: trimmedDefaultOrg.length > 0 ? trimmedDefaultOrg : null
      });
      await input.loadConnectors();
      input.setFlash({ tone: "success", text: "GitHub default organization updated." });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  const handleGitHubDisconnect = useCallback(async (): Promise<void> => {
    if (!input.activeWorkspaceId || !input.canManageGithub || !window.confirm("Disconnect GitHub for this workspace?")) {
      return;
    }
    input.setSaveError(null);
    input.setIsSaving(true);
    try {
      await input.api.delete(`/api/workspaces/${input.activeWorkspaceId}/connectors/github`);
      await input.loadConnectors();
      input.setFlash({ tone: "success", text: "GitHub connector disconnected for this workspace." });
    } catch (error) {
      input.setSaveError(readErrorMessage(error));
    } finally {
      input.setIsSaving(false);
    }
  }, [input]);

  return {
    handlePairCodeIssue,
    handleTelegramSetup,
    handleDiscordSetup,
    handleGitHubConnectorSetup,
    handleEmailSetup,
    handleEmailDisconnect,
    handleGitHubConnect,
    handleGitHubConnectExisting,
    handleGitHubAppConfigSave,
    handleGitHubDefaultOrgSave,
    handleGitHubDisconnect
  };
}
