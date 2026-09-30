import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { apiBaseUrl, type ApiClient } from "../../../lib/api";
import type { FlashMessage } from "../../../lib/types";
import { buildEmailInboundWebhookEndpoint, copyTextToClipboard } from "./adminSettingsDrafts";
import type {
  EmailInboundDebugEvent,
  EmailInboundDebugEventsResponse,
  SharedConnectorStatusResponse,
  SyncBrevoInboundWebhookResponse,
  UpdateEmailInboundConnectorResponse,
  UpdateListmonkConnectorResponse
} from "./shared";

type SharedConnectors = SharedConnectorStatusResponse["connectors"];

interface UseAdminConnectorSettingsInput {
  api: ApiClient;
  setError: (error: string | null) => void;
  setFlash: (flash: FlashMessage | null) => void;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
}

function useSharedChatConnectorDrafts(
  input: UseAdminConnectorSettingsInput,
  reloadSharedConnectorSettings: () => Promise<void>
) {
  const { api, setError, setFlash, setIsSaving } = input;
  const [sharedDiscordEnabledDraft, setSharedDiscordEnabledDraft] = useState(false);
  const [sharedDiscordTokenDraft, setSharedDiscordTokenDraft] = useState("");
  const [sharedTelegramEnabledDraft, setSharedTelegramEnabledDraft] = useState(false);
  const [sharedTelegramTokenDraft, setSharedTelegramTokenDraft] = useState("");
  const [sharedTelegramIngestModeDraft, setSharedTelegramIngestModeDraft] = useState<"webhook" | "polling">("webhook");

  function applyChatConnectorDrafts(connectors: SharedConnectors): void {
    setSharedDiscordEnabledDraft(connectors.discord.enabled);
    setSharedDiscordTokenDraft("");
    setSharedTelegramEnabledDraft(connectors.telegram.enabled);
    setSharedTelegramTokenDraft("");
    setSharedTelegramIngestModeDraft(connectors.telegram.telegramIngestMode);
  }

  async function saveSharedDiscordSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const trimmedToken = sharedDiscordTokenDraft.trim();
      await api.patch("/api/admin/connectors/shared/discord", {
        enabled: sharedDiscordEnabledDraft,
        ...(trimmedToken.length > 0 ? { botToken: trimmedToken } : {})
      });
      await reloadSharedConnectorSettings();
      setFlash({ tone: "success", text: "Shared Discord connector settings saved." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveSharedTelegramSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const trimmedToken = sharedTelegramTokenDraft.trim();
      await api.patch("/api/admin/connectors/shared/telegram", {
        enabled: sharedTelegramEnabledDraft,
        ingestMode: sharedTelegramIngestModeDraft,
        ...(trimmedToken.length > 0 ? { botToken: trimmedToken } : {})
      });
      await reloadSharedConnectorSettings();
      setFlash({ tone: "success", text: "Shared Telegram connector settings saved." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  return {
    sharedDiscordEnabledDraft,
    setSharedDiscordEnabledDraft,
    sharedDiscordTokenDraft,
    setSharedDiscordTokenDraft,
    sharedTelegramEnabledDraft,
    setSharedTelegramEnabledDraft,
    sharedTelegramTokenDraft,
    setSharedTelegramTokenDraft,
    sharedTelegramIngestModeDraft,
    setSharedTelegramIngestModeDraft,
    applyChatConnectorDrafts,
    saveSharedDiscordSettings,
    saveSharedTelegramSettings
  };
}

function useListmonkConnectorDraft(
  input: UseAdminConnectorSettingsInput,
  setSharedConnectors: Dispatch<SetStateAction<SharedConnectors | null>>
) {
  const { api, setError, setFlash, setIsSaving } = input;
  const [listmonkEnabledDraft, setListmonkEnabledDraft] = useState(false);
  const [listmonkBaseUrlDraft, setListmonkBaseUrlDraft] = useState("");
  const [listmonkApiUsernameDraft, setListmonkApiUsernameDraft] = useState("");
  const [listmonkApiTokenDraft, setListmonkApiTokenDraft] = useState("");

  function applyListmonkConnectorDraft(connector: SharedConnectors["listmonk"]): void {
    setListmonkEnabledDraft(connector.enabled);
    setListmonkBaseUrlDraft(connector.baseUrl ?? "");
    setListmonkApiUsernameDraft(connector.apiUsername ?? "");
    setListmonkApiTokenDraft("");
  }

  async function saveSharedListmonkSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const trimmedBaseUrl = listmonkBaseUrlDraft.trim();
      const trimmedUsername = listmonkApiUsernameDraft.trim();
      const trimmedToken = listmonkApiTokenDraft.trim();
      const response = await api.patch<UpdateListmonkConnectorResponse>("/api/admin/connectors/shared/listmonk", {
        enabled: listmonkEnabledDraft,
        baseUrl: trimmedBaseUrl.length > 0 ? trimmedBaseUrl : null,
        apiUsername: trimmedUsername.length > 0 ? trimmedUsername : null,
        ...(trimmedToken.length > 0 ? { apiToken: trimmedToken } : {})
      });

      setSharedConnectors((previous) => previous ? { ...previous, listmonk: response.connector } : previous);
      applyListmonkConnectorDraft(response.connector);
      setFlash(response.warning
        ? { tone: "error", text: response.warning }
        : { tone: "success", text: "Listmonk connector settings saved and templates synced." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  return {
    listmonkEnabledDraft,
    setListmonkEnabledDraft,
    listmonkBaseUrlDraft,
    setListmonkBaseUrlDraft,
    listmonkApiUsernameDraft,
    setListmonkApiUsernameDraft,
    listmonkApiTokenDraft,
    setListmonkApiTokenDraft,
    applyListmonkConnectorDraft,
    saveSharedListmonkSettings
  };
}

function useEmailInboundConnectorDraftState(sharedConnectors: SharedConnectors | null) {
  const [emailInboundEnabledDraft, setEmailInboundEnabledDraft] = useState(false);
  const [emailInboundDomainDraft, setEmailInboundDomainDraft] = useState("");
  const [emailInboundAddressModeDraft, setEmailInboundAddressModeDraft] = useState<"random" | "workspace_custom">("random");
  const [emailInboundDebugLoggingEnabledDraft, setEmailInboundDebugLoggingEnabledDraft] = useState(false);
  const [emailInboundWebhookSecretDraft, setEmailInboundWebhookSecretDraft] = useState("");
  const [emailInboundBrevoApiKeyDraft, setEmailInboundBrevoApiKeyDraft] = useState("");
  const [emailInboundDebugEvents, setEmailInboundDebugEvents] = useState<EmailInboundDebugEvent[]>([]);
  const [syncedBrevoWebhookUrl, setSyncedBrevoWebhookUrl] = useState<string | null>(null);
  const [isSyncingBrevoWebhook, setIsSyncingBrevoWebhook] = useState(false);
  const [isRefreshingEmailInboundDebugEvents, setIsRefreshingEmailInboundDebugEvents] = useState(false);
  const draftedWebhookSecret = emailInboundWebhookSecretDraft.trim();
  const emailInboundWebhookEndpoint = draftedWebhookSecret
    ? buildEmailInboundWebhookEndpoint(draftedWebhookSecret)
    : syncedBrevoWebhookUrl;
  const emailInboundWebhookEndpointPlaceholder = `${apiBaseUrl().replace(/\/+$/, "")}/api/connectors/email/inbound/brevo?token=<webhook-token>`;
  const hasPendingEmailInboundSecretEdits = Boolean(
    emailInboundWebhookSecretDraft.trim() || emailInboundBrevoApiKeyDraft.trim()
  );
  const canSyncBrevoInboundWebhook = Boolean(
    emailInboundEnabledDraft
      && emailInboundDomainDraft.trim()
      && sharedConnectors?.emailInbound.hasWebhookSecret
      && sharedConnectors?.emailInbound.hasBrevoApiKey
      && !hasPendingEmailInboundSecretEdits
  );

  function applyEmailInboundConnectorDraft(connector: SharedConnectors["emailInbound"]): void {
    setEmailInboundEnabledDraft(connector.enabled);
    setEmailInboundDomainDraft(connector.inboundDomain ?? "");
    setEmailInboundAddressModeDraft(connector.addressMode);
    setEmailInboundDebugLoggingEnabledDraft(connector.debugLoggingEnabled);
    setEmailInboundWebhookSecretDraft("");
    setEmailInboundBrevoApiKeyDraft("");
    setSyncedBrevoWebhookUrl(connector.webhookUrl ?? null);
  }

  return {
    emailInboundEnabledDraft,
    setEmailInboundEnabledDraft,
    emailInboundDomainDraft,
    setEmailInboundDomainDraft,
    emailInboundAddressModeDraft,
    setEmailInboundAddressModeDraft,
    emailInboundDebugLoggingEnabledDraft,
    setEmailInboundDebugLoggingEnabledDraft,
    emailInboundWebhookSecretDraft,
    setEmailInboundWebhookSecretDraft,
    emailInboundBrevoApiKeyDraft,
    setEmailInboundBrevoApiKeyDraft,
    emailInboundDebugEvents,
    setEmailInboundDebugEvents,
    syncedBrevoWebhookUrl,
    setSyncedBrevoWebhookUrl,
    emailInboundWebhookEndpoint,
    emailInboundWebhookEndpointPlaceholder,
    hasPendingEmailInboundSecretEdits,
    canSyncBrevoInboundWebhook,
    isSyncingBrevoWebhook,
    setIsSyncingBrevoWebhook,
    isRefreshingEmailInboundDebugEvents,
    setIsRefreshingEmailInboundDebugEvents,
    applyEmailInboundConnectorDraft
  };
}

function useEmailInboundConnectorActions(
  input: UseAdminConnectorSettingsInput,
  draft: ReturnType<typeof useEmailInboundConnectorDraftState>,
  setSharedConnectors: Dispatch<SetStateAction<SharedConnectors | null>>
) {
  const { api, setError, setFlash, setIsSaving } = input;

  async function reloadEmailInboundDebugEvents(): Promise<void> {
    draft.setIsRefreshingEmailInboundDebugEvents(true);
    setError(null);
    try {
      const response = await api.get<EmailInboundDebugEventsResponse>(
        "/api/admin/connectors/shared/email-inbound/debug-events?limit=200"
      );
      draft.setEmailInboundDebugEvents(response.events);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      draft.setIsRefreshingEmailInboundDebugEvents(false);
    }
  }

  async function saveSharedEmailInboundSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const trimmedInboundDomain = draft.emailInboundDomainDraft.trim();
      const trimmedWebhookSecret = draft.emailInboundWebhookSecretDraft.trim();
      const trimmedBrevoApiKey = draft.emailInboundBrevoApiKeyDraft.trim();
      const response = await api.patch<UpdateEmailInboundConnectorResponse>("/api/admin/connectors/shared/email-inbound", {
        enabled: draft.emailInboundEnabledDraft,
        inboundDomain: trimmedInboundDomain || null,
        addressMode: draft.emailInboundAddressModeDraft,
        debugLoggingEnabled: draft.emailInboundDebugLoggingEnabledDraft,
        ...(trimmedWebhookSecret ? { webhookSecret: trimmedWebhookSecret } : {}),
        ...(trimmedBrevoApiKey ? { brevoApiKey: trimmedBrevoApiKey } : {})
      });
      setSharedConnectors((previous) => previous ? { ...previous, emailInbound: response.connector } : previous);
      draft.applyEmailInboundConnectorDraft(response.connector);
      setFlash({ tone: "success", text: "Email inbound connector settings saved." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function syncBrevoInboundWebhook(): Promise<void> {
    draft.setIsSyncingBrevoWebhook(true);
    setError(null);
    try {
      const response = await api.post<SyncBrevoInboundWebhookResponse>(
        "/api/admin/connectors/shared/email-inbound/brevo-webhook/sync"
      );
      draft.setSyncedBrevoWebhookUrl(response.webhook.url);
      const actionText = response.action === "created" ? "created" : response.action === "updated" ? "updated" : "already up to date";
      setFlash({ tone: "success", text: `Brevo inbound webhook ${actionText}: #${response.webhook.id}.` });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      draft.setIsSyncingBrevoWebhook(false);
    }
  }

  async function copyGeneratedEmailWebhookUrl(): Promise<void> {
    const value = draft.emailInboundWebhookEndpoint ?? draft.syncedBrevoWebhookUrl;
    if (!value) {
      setError("Save Email Inbound settings with a webhook token first.");
      return;
    }
    if (!await copyTextToClipboard(value)) {
      setError("Unable to copy webhook endpoint. Copy it manually from the field.");
      return;
    }
    setFlash({ tone: "success", text: "Email inbound webhook endpoint copied." });
  }

  return {
    reloadEmailInboundDebugEvents,
    saveSharedEmailInboundSettings,
    syncBrevoInboundWebhook,
    copyGeneratedEmailWebhookUrl
  };
}

function useEmailInboundConnectorDraft(
  input: UseAdminConnectorSettingsInput,
  sharedConnectors: SharedConnectors | null,
  setSharedConnectors: Dispatch<SetStateAction<SharedConnectors | null>>
) {
  const draft = useEmailInboundConnectorDraftState(sharedConnectors);
  const actions = useEmailInboundConnectorActions(input, draft, setSharedConnectors);
  return { ...draft, ...actions };
}
export function useAdminConnectorSettings(input: UseAdminConnectorSettingsInput) {
  const [sharedConnectors, setSharedConnectors] = useState<SharedConnectors | null>(null);
  let reloadSharedConnectorSettings = async (): Promise<void> => undefined;
  const chat = useSharedChatConnectorDrafts(input, () => reloadSharedConnectorSettings());
  const listmonk = useListmonkConnectorDraft(input, setSharedConnectors);
  const emailInbound = useEmailInboundConnectorDraft(input, sharedConnectors, setSharedConnectors);

  function applyConnectorSnapshot(connectors: SharedConnectors, debugEvents?: EmailInboundDebugEvent[]): void {
    setSharedConnectors(connectors);
    chat.applyChatConnectorDrafts(connectors);
    listmonk.applyListmonkConnectorDraft(connectors.listmonk);
    emailInbound.applyEmailInboundConnectorDraft(connectors.emailInbound);
    if (debugEvents) {
      emailInbound.setEmailInboundDebugEvents(debugEvents);
    }
  }

  reloadSharedConnectorSettings = async (): Promise<void> => {
    const response = await input.api.get<SharedConnectorStatusResponse>("/api/admin/connectors/shared");
    applyConnectorSnapshot(response.connectors);
  };

  return {
    sharedConnectors,
    ...chat,
    ...listmonk,
    ...emailInbound,
    applyConnectorSnapshot
  };
}
