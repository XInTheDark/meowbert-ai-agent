import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("./discord-binding-state.js", () => ({
  shouldRejectDiscordInboundForBinding: vi.fn()
}));

vi.mock("../connector-agent.js", () => ({
  normalizeConnectorAgentId: vi.fn(() => null)
}));

vi.mock("../connector-execution-errors.js", () => ({
  describeConnectorExecutionError: vi.fn(() => null)
}));

vi.mock("../../platform/platform-model-metadata.js", () => ({
  resolveContextWindowTokensForWorkspace: vi.fn(async () => 32_000)
}));

vi.mock("../connector-master-ingest.js", () => ({
  resolveConnectorMasterTarget: vi.fn(),
  deliverConnectorMessageToMaster: vi.fn()
}));

vi.mock("../connector-threads.js", () => ({
  connectorThreadHasInboundMessages: vi.fn(async () => true),
  findConnectorThread: vi.fn(),
  getOrCreateConnectorThread: vi.fn(),
  isConnectorThreadMidConversation: vi.fn()
}));

vi.mock("../connector-pairing.js", () => ({
  consumeConnectorPairCodeIfPresent: vi.fn(async () => ({ handled: false, outcome: "invalid" })),
  resolveConnectorPairedUserId: vi.fn()
}));

import { shouldRejectDiscordInboundForBinding } from "./discord-binding-state.js";
import { describeConnectorExecutionError } from "../connector-execution-errors.js";
import {
  deliverConnectorMessageToMaster,
  resolveConnectorMasterTarget,
  type ConnectorMasterTarget
} from "../connector-master-ingest.js";
import {
  findConnectorThread,
  getOrCreateConnectorThread,
  isConnectorThreadMidConversation
} from "../connector-threads.js";
import { resolveConnectorPairedUserId } from "../connector-pairing.js";
import { processDiscordMessageForBinding } from "./index.js";

const target: ConnectorMasterTarget = {
  source: "discord",
  workspaceId: "workspace-1",
  environmentId: "environment-1",
  masterTaskId: "master-1",
  actorUserId: "user-1",
  routingNote: null
};

const binding = {
  id: "binding-1",
  workspace_id: "workspace-1",
  status: "active",
  config_json: {
    connectionMode: "custom",
    botToken: "discord-token",
    botUserId: "999",
    mentionOnly: true
  }
};

function channelMessage(content: string, mentions: Array<{ id: string }> = []) {
  return {
    id: "1001",
    channel_id: "111",
    guild_id: "222",
    content,
    author: { id: "123", username: "alice", bot: false },
    mentions
  };
}

describe("processDiscordMessageForBinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shouldRejectDiscordInboundForBinding).mockReturnValue(false);
    vi.mocked(resolveConnectorPairedUserId).mockResolvedValue("user-1");
    vi.mocked(findConnectorThread).mockResolvedValue({ id: "thread-1" });
    vi.mocked(getOrCreateConnectorThread).mockResolvedValue({ id: "thread-1" });
    vi.mocked(isConnectorThreadMidConversation).mockResolvedValue(false);
    vi.mocked(resolveConnectorMasterTarget).mockResolvedValue(target);
    vi.mocked(deliverConnectorMessageToMaster).mockResolvedValue({
      processed: true,
      taskId: "master-1",
      environmentId: "environment-1",
      action: "sent_to_master"
    });
  });

  it("sends a mentioned message to the project Master", async () => {
    const result = await processDiscordMessageForBinding(binding, channelMessage("<@999> status?", [{ id: "999" }]));

    expect(result).toMatchObject({ processed: true, taskId: "master-1", action: "sent_to_master" });
    expect(resolveConnectorMasterTarget).toHaveBeenCalledWith(
      expect.objectContaining({ source: "discord", workspaceId: "workspace-1", actorUserId: "user-1" })
    );
    expect(deliverConnectorMessageToMaster).toHaveBeenCalledWith(
      expect.objectContaining({ target, threadId: "thread-1", inboundMessageId: "1001" })
    );
  });

  it("keeps a channel conversation going without a fresh mention while the Master is still working", async () => {
    vi.mocked(isConnectorThreadMidConversation).mockResolvedValue(true);

    const result = await processDiscordMessageForBinding(binding, channelMessage("please change direction"));

    expect(result).toMatchObject({ processed: true, action: "sent_to_master" });
    expect(isConnectorThreadMidConversation).toHaveBeenCalledWith("thread-1");
    expect(deliverConnectorMessageToMaster).toHaveBeenCalledTimes(1);
  });

  it("ignores unmentioned channel chatter when the Master is not mid-conversation", async () => {
    const result = await processDiscordMessageForBinding(binding, channelMessage("random chatter"));

    expect(result).toEqual({ processed: false });
    expect(deliverConnectorMessageToMaster).not.toHaveBeenCalled();
  });

  it("tells the channel why nothing happened when the workspace cannot take connector messages", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(resolveConnectorMasterTarget).mockRejectedValue(new Error("master off"));
    vi.mocked(describeConnectorExecutionError).mockReturnValue("Connectors need the Project Master.");

    const result = await processDiscordMessageForBinding(binding, channelMessage("<@999> hi", [{ id: "999" }]));

    expect(result).toEqual({ processed: false });
    expect(deliverConnectorMessageToMaster).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/111/messages",
      expect.objectContaining({ body: expect.stringContaining("Connectors need the Project Master.") })
    );
    vi.unstubAllGlobals();
  });
});
