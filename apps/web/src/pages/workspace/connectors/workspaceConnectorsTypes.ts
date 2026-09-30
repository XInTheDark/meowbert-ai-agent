import type { TaskToolOptions } from "../../../lib/types";
export type {
  WorkspaceSourceConnectStartResponse,
  WorkspaceSourceListResponse,
  WorkspaceSourceSummary
} from "../../../sources/sourceTypes";

export type MessageConnectorType = "telegram" | "discord" | "email";
export type PairableConnectorType = "telegram" | "discord" | "github";
export type ConnectorBindingType = MessageConnectorType | "github";
export type ConnectorTab = "telegram" | "discord" | "github" | "email" | "sources";

export interface ConnectorBinding {
  id: string;
  type: ConnectorBindingType;
  status: string;
  webhookUrl?: string | null;
  config: {
    connectionMode?: "custom" | "shared";
    botToken?: string;
    mode?: "webhook" | "polling" | "gateway" | "shared" | "inbound";
    defaultEnvironmentId?: string;
    agentId?: string | null;
    tools?: TaskToolOptions;
    prefixEnabled?: boolean;
    keywordEnabled?: boolean;
    llmFallbackEnabled?: boolean;
    channelHistoryEnabled?: boolean;
    channelHistoryMaxChars?: number;
    channelHistoryIncludePinnedMessages?: boolean;
    localPart?: string | null;
    emailAddress?: string | null;
    senderPolicy?: "allow_any" | "trusted_only";
    trustedSenders?: string[];
  };
  pairing?: {
    paired: boolean;
    pairedAt: string | null;
  };
}

export interface TelegramSetupResponse {
  id: string;
  webhookUrl: string | null;
  mode: "webhook" | "polling" | "shared";
  bot?: {
    id: number | null;
    username: string | null;
    firstName: string | null;
  } | null;
}

export interface DiscordSetupResponse {
  id: string;
  mode: "gateway" | "shared";
  bot: {
    id: string | null;
    username: string | null;
    globalName: string | null;
  };
}

export interface ConnectorPairCodeResponse {
  connectorType: PairableConnectorType;
  code: string;
  expiresAt: string;
  instructions: string;
}

export interface GitHubConnectorStatusResponse {
  enabled: boolean;
  canManage: boolean;
  setup: {
    callbackUrl: string;
    webhookUrl: string;
    requiredEvents: string[];
  };
  app:
    | {
        configured: false;
      }
    | {
        configured: true;
        appId: string;
        appSlug: string;
        defaultOrg: string | null;
        hasPrivateKeyPem: boolean;
        hasWebhookSecret: boolean;
        hasClientId: boolean;
        hasClientSecret: boolean;
        updatedAt: string;
      };
  installation:
    | {
        connected: false;
      }
    | {
        connected: true;
        installationId: string;
        accountLogin: string | null;
        accountType: string | null;
        connectedAt: string | null;
        access: {
          ok: boolean;
          error: string | null;
          expiresAt: string | null;
          repositorySelection: string | null;
          contentsPermission: string | null;
          canReadContents: boolean;
          canWriteContents: boolean;
        } | null;
      };
}

export interface GitHubInstallStartResponse {
  installUrl: string;
  expiresAt: string;
}

export interface GitHubExistingInstallResponse {
  ok: true;
  installation: {
    connected: true;
    installationId: string | null;
    accountLogin: string | null;
    accountType: string | null;
    connectedAt: string | null;
  };
}

export interface GitHubConnectorSetupResponse {
  id: string;
  webhookUrl: string;
  mentionLogin: string;
}

export interface SharedConnectorCapability {
  enabled: boolean;
  hasToken: boolean;
}

export interface SharedEmailConnectorCapability {
  enabled: boolean;
  inboundDomain: string | null;
  addressMode: "random" | "workspace_custom";
}

export interface SharedConnectorStatus {
  canManageConnectors: boolean;
  telegram: SharedConnectorCapability;
  discord: SharedConnectorCapability;
  email: SharedEmailConnectorCapability;
}

export interface WorkspaceConnectorListResponse {
  items: ConnectorBinding[];
  shared: SharedConnectorStatus;
}

export interface EmailConnectorStatusResponse {
  enabled: boolean;
  canManage: boolean;
  admin: {
    enabled: boolean;
    inboundDomain: string | null;
    addressMode: "random" | "workspace_custom";
    hasWebhookSecret: boolean;
    hasBrevoApiKey: boolean;
  };
  connector:
    | {
        connected: false;
      }
    | {
        connected: true;
        status: string;
        localPart: string;
        emailAddress: string | null;
        senderPolicy: "allow_any" | "trusted_only";
        trustedSenders: string[];
        defaultEnvironmentId: string | null;
        agentId: string | null;
        tools: TaskToolOptions;
        prefixEnabled: boolean;
        keywordEnabled: boolean;
        llmFallbackEnabled: boolean;
      };
}

export interface EmailConnectorSetupResponse {
  id: string;
  status: string;
  localPart: string;
  emailAddress: string | null;
  senderPolicy: "allow_any" | "trusted_only";
  trustedSenders: string[];
  defaultEnvironmentId: string | null;
  agentId: string | null;
  tools: TaskToolOptions;
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
}
