import { getSourceProviderClient } from "./provider-clients.js";
import { getSourceCatalogEntry } from "./source-catalog.js";
import {
  buildPkcePair,
  DESKTOP_SOURCE_RETURN_ORIGIN,
  generateSourceOauthState,
  normalizeSourceReturnOrigin
} from "./oauth-helpers.js";
import {
  createSourceOauthBrowserBinding,
  hashSourceOauthBrowserNonce
} from "./oauth-browser-binding.js";
import { createWorkspaceSourceOauthState, consumeWorkspaceSourceOauthState } from "./oauth-states.js";
import { getSourceProviderSettings, isSourceProviderReady } from "./provider-settings.js";
import { upsertWorkspaceSourceConnection } from "./workspace-source-connections.js";
import type { SourceProvider, WorkspaceSourceOauthState } from "./source-types.js";
import { config } from "../../lib/config.js";

export function buildSourceCallbackUrl(provider: SourceProvider): string {
  const trimmedPublicUrl = config.server.publicUrl.replace(/\/+$/, "");
  return `${trimmedPublicUrl}/api/sources/oauth/${provider}/callback`;
}

export async function beginWorkspaceSourceOAuth(input: {
  workspaceId: string;
  userId: string;
  sourceId: string;
  returnOrigin?: string | null;
}): Promise<{ authorizeUrl: string; expiresAt: string; setCookieHeader: string }> {
  const sourceEntry = getSourceCatalogEntry(input.sourceId);
  if (!sourceEntry) {
    throw new Error(`Source not found: ${input.sourceId}`);
  }

  const providerSettings = await getSourceProviderSettings(sourceEntry.provider);
  if (!isSourceProviderReady(providerSettings)) {
    throw new Error("This source provider is not configured by the server admin.");
  }

  const { codeVerifier, codeChallenge } = buildPkcePair();
  const state = generateSourceOauthState();
  const returnOrigin = normalizeSourceReturnOrigin(input.returnOrigin);
  if (returnOrigin === DESKTOP_SOURCE_RETURN_ORIGIN) {
    throw new Error("Source connections must currently be completed in the web app.");
  }
  const callbackUrl = buildSourceCallbackUrl(sourceEntry.provider);
  const browserBinding = createSourceOauthBrowserBinding({
    provider: sourceEntry.provider,
    state,
    secure: new URL(callbackUrl).protocol === "https:"
  });
  const { expiresAt } = await createWorkspaceSourceOauthState({
    state,
    workspaceId: input.workspaceId,
    userId: input.userId,
    provider: sourceEntry.provider,
    codeVerifier,
    browserNonceHash: browserBinding.nonceHash,
    returnOrigin
  });

  const providerClient = getSourceProviderClient(sourceEntry.provider);
  return {
    authorizeUrl: providerClient.buildAuthorizationUrl({
      clientId: providerSettings.clientId!,
      redirectUri: callbackUrl,
      state,
      codeChallenge
    }),
    expiresAt,
    setCookieHeader: browserBinding.setCookieHeader
  };
}

export async function exchangeWorkspaceSourceOauthState(input: {
  oauthState: WorkspaceSourceOauthState;
  code: string;
  callbackQuery?: Record<string, string | undefined>;
}): Promise<{ workspaceId: string; returnOrigin: string; sourceId: string }> {
  const providerSettings = await getSourceProviderSettings(input.oauthState.provider);
  if (!isSourceProviderReady(providerSettings)) {
    throw new Error("This source provider is not configured by the server admin.");
  }

  const providerClient = getSourceProviderClient(input.oauthState.provider);
  const tokens = await providerClient.exchangeCode({
    clientId: providerSettings.clientId!,
    clientSecret: providerSettings.clientSecret!,
    redirectUri: buildSourceCallbackUrl(input.oauthState.provider),
    code: input.code,
    codeVerifier: input.oauthState.codeVerifier,
    callbackQuery: input.callbackQuery
  });
  const account = await providerClient.fetchAccountProfile({ accessToken: tokens.accessToken, tokens });

  await upsertWorkspaceSourceConnection({
    workspaceId: input.oauthState.workspaceId,
    provider: input.oauthState.provider,
    tokens,
    accountId: account.accountId,
    accountLabel: account.accountLabel,
    updatedByUserId: input.oauthState.userId
  });

  return {
    workspaceId: input.oauthState.workspaceId,
    returnOrigin: input.oauthState.returnOrigin,
    sourceId: input.oauthState.provider
  };
}

export async function consumeWorkspaceSourceOAuth(input: {
  provider: SourceProvider;
  state: string;
  browserNonce: string;
}): Promise<WorkspaceSourceOauthState> {
  const oauthState = await consumeWorkspaceSourceOauthState({
    state: input.state,
    provider: input.provider,
    browserNonceHash: hashSourceOauthBrowserNonce(input.browserNonce)
  });
  if (!oauthState) {
    throw new Error("Source OAuth state is invalid or expired.");
  }

  return oauthState;
}
