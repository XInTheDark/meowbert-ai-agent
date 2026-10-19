import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("./agent-swarm-channel-access.js", () => ({
  channelsForSwarmTarget: vi.fn(),
  resolveSwarmChannelForAgent: vi.fn()
}));

import { query } from "../../lib/db.js";
import { resolveSwarmChannelForAgent } from "./agent-swarm-channel-access.js";
import { readSwarmChannel } from "./agent-swarm-messaging.js";
import { SWARM_READ_CHANNEL_MESSAGE_LIMIT } from "./shared.js";
import { createSwarmTestContext } from "./agent-swarm.test-fixtures.js";

function messageRow(messageNo: number) {
  return {
    id: `message-${messageNo}`,
    message_no: messageNo,
    created_at: "2026-10-19T00:00:00.000Z",
    sender_task_id: "worker-task-1",
    sender_role: "worker",
    sender_slot_index: 0,
    content_markdown: `Report ${messageNo}`
  };
}

describe("readSwarmChannel", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSwarmChannelForAgent).mockResolvedValue({ id: "global-channel" } as never);
  });

  it("returns the latest messages in order when the channel is longer than one read", async () => {
    const total = SWARM_READ_CHANNEL_MESSAGE_LIMIT + 50;
    mockedQuery.mockImplementation((async (sql: string) => {
      const descending = /ORDER BY m\.message_no DESC/.test(sql);
      const all = Array.from({ length: total }, (_, index) => messageRow(index + 1));
      const ordered = descending ? all.reverse() : all;
      return { rows: ordered.slice(0, SWARM_READ_CHANNEL_MESSAGE_LIMIT + 1) };
    }) as never);

    const result = await readSwarmChannel(createSwarmTestContext() as never, { channelId: "global" });

    expect(result.hasMore).toBe(true);
    expect(result.messages).toHaveLength(SWARM_READ_CHANNEL_MESSAGE_LIMIT);
    expect(result.messages.at(-1)?.messageNo).toBe(total);
    expect(result.messages[0]?.messageNo).toBe(total - SWARM_READ_CHANNEL_MESSAGE_LIMIT + 1);
  });
});
