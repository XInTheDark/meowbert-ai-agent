/** @vitest-environment jsdom */

import { act, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SetURLSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import { buildDefaultTaskToolOptions } from "../../../task/taskInputDrafts";
import { useWorkspaceConnectorsLoading } from "./useWorkspaceConnectorsLoading";

function createSetter<T>(): Dispatch<SetStateAction<T>> {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

function createLoadingSetters() {
  return {
    setIsLoading: createSetter<boolean>(),
    setLoadError: createSetter<string | null>(),
    setSaveError: createSetter<string | null>(),
    setLastSetupWebhookUrl: createSetter<string | null>(),
    setPairCodeByConnector: createSetter<Record<"telegram" | "discord" | "github", { code: string; expiresAt: string; instructions: string } | null>>(),
    setTelegramConnector: createSetter<any>(),
    setTelegramConnectionMode: createSetter<"custom" | "shared">(),
    setTelegramMode: createSetter<"webhook" | "polling">(),
    setTelegramAgentId: createSetter<string | null>(),
    setTelegramTools: createSetter<ReturnType<typeof buildDefaultTaskToolOptions>>(),
    setTelegramPrefixEnabled: createSetter<boolean>(),
    setTelegramKeywordEnabled: createSetter<boolean>(),
    setTelegramLlmFallbackEnabled: createSetter<boolean>(),
    setDiscordConnector: createSetter<any>(),
    setDiscordConnectionMode: createSetter<"custom" | "shared">(),
    setDiscordAgentId: createSetter<string | null>(),
    setDiscordTools: createSetter<ReturnType<typeof buildDefaultTaskToolOptions>>(),
    setDiscordPrefixEnabled: createSetter<boolean>(),
    setDiscordKeywordEnabled: createSetter<boolean>(),
    setDiscordLlmFallbackEnabled: createSetter<boolean>(),
    setDiscordChannelHistoryEnabled: createSetter<boolean>(),
    setDiscordChannelHistoryMaxCharsDraft: createSetter<string>(),
    setDiscordChannelHistoryIncludePinnedMessages: createSetter<boolean>(),
    setEmailBinding: createSetter<any>(),
    setEmailConnectorStatus: createSetter<any>(),
    setEmailLocalPartDraft: createSetter<string>(),
    setEmailSenderPolicy: createSetter<"allow_any" | "trusted_only">(),
    setEmailTrustedAddressesDraft: createSetter<string>(),
    setEmailAgentId: createSetter<string | null>(),
    setEmailTools: createSetter<ReturnType<typeof buildDefaultTaskToolOptions>>(),
    setEmailPrefixEnabled: createSetter<boolean>(),
    setEmailKeywordEnabled: createSetter<boolean>(),
    setEmailLlmFallbackEnabled: createSetter<boolean>(),
    setGithubBinding: createSetter<any>(),
    setGithubConnector: createSetter<any>(),
    setGithubAgentId: createSetter<string | null>(),
    setGithubTools: createSetter<ReturnType<typeof buildDefaultTaskToolOptions>>(),
    setGithubPrefixEnabled: createSetter<boolean>(),
    setGithubKeywordEnabled: createSetter<boolean>(),
    setGithubLlmFallbackEnabled: createSetter<boolean>(),
    setSharedConnectorStatus: createSetter<any>(),
    setGithubDefaultOrgDraft: createSetter<string>(),
    setGithubAppConfigJsonDraft: createSetter<string>(),
    setTelegramDefaultEnvironmentId: createSetter<string>(),
    setDiscordDefaultEnvironmentId: createSetter<string>(),
    setEmailDefaultEnvironmentId: createSetter<string>(),
    setGithubDefaultEnvironmentId: createSetter<string>()
  };
}

function createApiClientMock(): ApiClient {
  const getImpl: ApiClient["get"] = async <T,>(path: string): Promise<T> => {
    if (path.endsWith("/connectors")) {
      return {
        items: [
          {
            id: "discord-1",
            type: "discord",
            status: "active",
            config: {
              agentId: "fast",
              tools: buildDefaultTaskToolOptions(),
              prefixEnabled: true,
              keywordEnabled: true,
              llmFallbackEnabled: true
            }
          }
        ],
        shared: {
          canManageConnectors: true,
          telegram: { enabled: false, hasToken: false },
          discord: { enabled: false, hasToken: false },
          email: { enabled: false, inboundDomain: null, addressMode: "random" }
        }
      } as T;
    }

    if (path.endsWith("/connectors/github")) {
      return {
        enabled: true,
        canManage: true,
        setup: {
          callbackUrl: "https://example.com/callback",
          webhookUrl: "https://example.com/webhook",
          requiredEvents: []
        },
        app: { configured: false },
        installation: { connected: false }
      } as T;
    }

    if (path.endsWith("/connectors/email")) {
      return {
        enabled: true,
        canManage: true,
        admin: {
          enabled: true,
          inboundDomain: "example.com",
          addressMode: "random",
          hasWebhookSecret: true,
          hasBrevoApiKey: true
        },
        connector: { connected: false }
      } as T;
    }

    throw new Error(`Unexpected path: ${path}`);
  };
  const get = vi.fn(getImpl) as ApiClient["get"];

  return {
    get,
    post: vi.fn() as ApiClient["post"],
    postForm: vi.fn() as ApiClient["postForm"],
    patch: vi.fn() as ApiClient["patch"],
    put: vi.fn() as ApiClient["put"],
    delete: vi.fn() as ApiClient["delete"]
  };
}

function HookHarness(props: {
  api: ApiClient;
  setters: ReturnType<typeof createLoadingSetters>;
  searchParams?: URLSearchParams;
  setSearchParams?: SetURLSearchParams;
}) {
  const [rerenderCount, setRerenderCount] = useState(0);
  const defaultToolOptions = useMemo(() => buildDefaultTaskToolOptions(), []);
  const searchParams = useMemo(() => props.searchParams ?? new URLSearchParams(), [props.searchParams]);
  const setSearchParams = useMemo(() => props.setSearchParams ?? (vi.fn() as unknown as SetURLSearchParams), [props.setSearchParams]);
  const setFlash = useMemo(() => vi.fn(), []);

  useWorkspaceConnectorsLoading({
    api: props.api,
    activeWorkspaceId: "ws_1",
    defaultToolOptions,
    workspaceMemoryEnabled: false,
    searchParams,
    setSearchParams,
    setFlash,
    ...props.setters
  });

  return (
    <button type="button" id="rerender" onClick={() => setRerenderCount((value) => value + 1)}>
      rerender {rerenderCount}
    </button>
  );
}

describe("useWorkspaceConnectorsLoading", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = null;
    if (container) {
      container.remove();
    }
    container = null;
  });

  it("does not reload connectors again on unrelated rerenders", async () => {
    const api = createApiClientMock();
    const setters = createLoadingSetters();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<HookHarness api={api} setters={setters} />);
    });

    expect(api.get).toHaveBeenCalledTimes(3);

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#rerender")?.click();
    });

    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it("clears github install status without dropping a newer tab query param", async () => {
    const api = createApiClientMock();
    const setters = createLoadingSetters();
    const setSearchParams = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <HookHarness
          api={api}
          setters={setters}
          searchParams={new URLSearchParams("github_install=success")}
          setSearchParams={setSearchParams}
        />
      );
    });

    expect(setSearchParams).toHaveBeenCalledTimes(1);
    expect(setSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true });

    const updater = setSearchParams.mock.calls[0]?.[0] as ((params: URLSearchParams) => URLSearchParams);
    const nextParams = updater(new URLSearchParams("github_install=success&tab=sources"));

    expect(nextParams.toString()).toBe("tab=sources");
  });
});
