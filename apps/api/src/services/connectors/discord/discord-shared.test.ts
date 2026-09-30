import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../connector-pairing.js", () => ({
  consumeConnectorPairCodeForConnectorIfPresent: vi.fn()
}));

vi.mock("../shared-connector-chat.js", () => ({
  findSharedWorkspaceBindingBySlug: vi.fn(),
  getConnectorChatContext: vi.fn(),
  grantConnectorExternalAccess: vi.fn(),
  listSharedWorkspaceCandidates: vi.fn(),
  revokeConnectorExternalAccess: vi.fn(),
  upsertConnectorChatContext: vi.fn()
}));

vi.mock("./index.js", () => ({
  getDiscordBindingById: vi.fn(),
  processAuthorizedDiscordMessageForBinding: vi.fn()
}));

vi.mock("./discord-binding-state.js", () => ({
  resolveDiscordConnectionMode: vi.fn((configJson: Record<string, unknown>) =>
    configJson.connectionMode === "custom" ? "custom" : "shared"
  ),
  syncDiscordBindingBotIdentityIfChanged: vi.fn()
}));

import { consumeConnectorPairCodeForConnectorIfPresent } from "../connector-pairing.js";
import {
  getConnectorChatContext,
  listSharedWorkspaceCandidates,
  upsertConnectorChatContext
} from "../shared-connector-chat.js";
import {
  getDiscordBindingById,
  processAuthorizedDiscordMessageForBinding
} from "./index.js";
import { syncDiscordBindingBotIdentityIfChanged } from "./discord-binding-state.js";
import { processSharedDiscordMessage } from "./discord-shared.js";

describe("processSharedDiscordMessage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({})
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(consumeConnectorPairCodeForConnectorIfPresent).mockResolvedValue({
      handled: false,
      outcome: "invalid"
    });
    vi.mocked(syncDiscordBindingBotIdentityIfChanged).mockImplementation(async (input) => input.currentConfigJson);
    vi.mocked(getDiscordBindingById).mockResolvedValue({
      id: "binding-1",
      workspace_id: "workspace-1",
      status: "active",
      config_json: {
        connectionMode: "shared",
        botUserId: "999"
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts shared channel commands without mentioning the bot", async () => {
    vi.mocked(getConnectorChatContext).mockResolvedValue({
      id: "context-1",
      connectorType: "discord",
      externalChatId: "111",
      externalThreadId: "",
      bindingId: "binding-1",
      workspaceId: "workspace-1",
      discordAccessMode: "restricted"
    });
    vi.mocked(listSharedWorkspaceCandidates).mockResolvedValue({
      identity: {
        userId: "user-1",
        isSuperAdmin: true
      },
      candidates: [{
        bindingId: "binding-1",
        workspaceId: "workspace-1",
        workspaceSlug: "ws-one",
        workspaceName: "Workspace One",
        hasPairing: true,
        hasGrant: false
      }]
    });
    vi.mocked(upsertConnectorChatContext).mockResolvedValue({
      id: "context-1",
      connectorType: "discord",
      externalChatId: "channel-1",
      externalThreadId: "",
      bindingId: "binding-1",
      workspaceId: "workspace-1",
      discordAccessMode: "open"
    });

    const result = await processSharedDiscordMessage({
      sharedBotToken: "bot-token",
      sharedBotUserId: "999",
      message: {
        id: "333",
        channel_id: "111",
        guild_id: "222",
        content: "/open",
        author: {
          id: "123",
          username: "alice",
          bot: false
        },
        mentions: []
      }
    });

    expect(result).toEqual({ processed: false });
    expect(upsertConnectorChatContext).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "binding-1",
        discordAccessMode: "open"
      })
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends guidance when a mentioned public-channel message has no workspace context", async () => {
    vi.mocked(getConnectorChatContext).mockResolvedValue(null);
    vi.mocked(listSharedWorkspaceCandidates).mockResolvedValue({
      identity: {
        userId: "user-1",
        isSuperAdmin: false
      },
      candidates: [
        {
          bindingId: "binding-1",
          workspaceId: "workspace-1",
          workspaceSlug: "ws-one",
          workspaceName: "Workspace One",
          hasPairing: true,
          hasGrant: false
        },
        {
          bindingId: "binding-2",
          workspaceId: "workspace-2",
          workspaceSlug: "ws-two",
          workspaceName: "Workspace Two",
          hasPairing: true,
          hasGrant: false
        }
      ]
    });

    const result = await processSharedDiscordMessage({
      sharedBotToken: "bot-token",
      sharedBotUserId: "999",
      message: {
        id: "334",
        channel_id: "111",
        guild_id: "222",
        content: "<@999> hello",
        author: {
          id: "123",
          username: "alice",
          bot: false
        },
        mentions: [{ id: "999" }]
      }
    });

    expect(result).toEqual({ processed: false });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      content: "This channel is not linked to a workspace yet. Run /workspace use <slug> here first."
    });
  });

  it("sends guidance when the channel is restricted and the sender lacks access", async () => {
    vi.mocked(getConnectorChatContext).mockResolvedValue({
      id: "context-1",
      connectorType: "discord",
      externalChatId: "111",
      externalThreadId: "",
      bindingId: "binding-9",
      workspaceId: "workspace-9",
      discordAccessMode: "restricted"
    });
    vi.mocked(listSharedWorkspaceCandidates).mockResolvedValue({
      identity: null,
      candidates: []
    });

    const result = await processSharedDiscordMessage({
      sharedBotToken: "bot-token",
      sharedBotUserId: "999",
      message: {
        id: "335",
        channel_id: "111",
        guild_id: "222",
        content: "<@999> hello",
        author: {
          id: "123",
          username: "alice",
          bot: false
        },
        mentions: [{ id: "999" }]
      }
    });

    expect(result).toEqual({ processed: false });
    expect(processAuthorizedDiscordMessageForBinding).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      content: "This channel is restricted. Ask an admin to run /open here or grant you access."
    });
  });

  it("ignores stale channel context and falls back to the only current shared workspace", async () => {
    vi.mocked(getConnectorChatContext).mockResolvedValue({
      id: "context-1",
      connectorType: "discord",
      externalChatId: "111",
      externalThreadId: "",
      bindingId: "binding-stale",
      workspaceId: "workspace-stale",
      discordAccessMode: "open"
    });
    vi.mocked(getDiscordBindingById)
      .mockResolvedValueOnce({
        id: "binding-stale",
        workspace_id: "workspace-stale",
        status: "active",
        config_json: {
          connectionMode: "custom",
          botUserId: "123"
        }
      })
      .mockResolvedValueOnce({
        id: "binding-1",
        workspace_id: "workspace-1",
        status: "active",
        config_json: {
          connectionMode: "shared",
          botUserId: "999"
        }
      });
    vi.mocked(listSharedWorkspaceCandidates).mockResolvedValue({
      identity: {
        userId: "user-1",
        isSuperAdmin: false
      },
      candidates: [{
        bindingId: "binding-1",
        workspaceId: "workspace-1",
        workspaceSlug: "ws-one",
        workspaceName: "Workspace One",
        hasPairing: true,
        hasGrant: false
      }]
    });
    vi.mocked(upsertConnectorChatContext).mockResolvedValue({
      id: "context-2",
      connectorType: "discord",
      externalChatId: "111",
      externalThreadId: "",
      bindingId: "binding-1",
      workspaceId: "workspace-1",
      discordAccessMode: "restricted"
    });
    vi.mocked(processAuthorizedDiscordMessageForBinding).mockResolvedValue({
      processed: true,
      taskId: "task-1",
      environmentId: "env-1",
      action: "sent_to_master"
    });

    const result = await processSharedDiscordMessage({
      sharedBotToken: "bot-token",
      sharedBotUserId: "999",
      message: {
        id: "336",
        channel_id: "111",
        guild_id: "222",
        content: "<@999> hello",
        author: {
          id: "123",
          username: "alice",
          bot: false
        },
        mentions: [{ id: "999" }]
      }
    });

    expect(result).toMatchObject({
      processed: true,
      taskId: "task-1"
    });
    expect(upsertConnectorChatContext).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "binding-1",
        workspaceId: "workspace-1"
      })
    );
    expect(processAuthorizedDiscordMessageForBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({
          id: "binding-1"
        }),
        expectedConnectionMode: "shared",
        receivedByBotUserId: "999"
      })
    );
  });
});
