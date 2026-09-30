import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

import {
  clearDiscordConnectorRoutingState,
  hasDiscordBindingOwnerChanged,
  resolveDiscordBindingOwnerKey,
  shouldRejectDiscordInboundForBinding,
  syncDiscordBindingBotIdentityIfChanged,
  syncSharedDiscordBindingBotIdentity
} from "./discord-binding-state.js";
import { withTransaction } from "../../../lib/db.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("resolveDiscordBindingOwnerKey", () => {
  it("includes the connection mode in the owner key", () => {
    expect(
      resolveDiscordBindingOwnerKey({
        connectionMode: "custom",
        botUserId: "123456789"
      })
    ).toBe("custom:123456789");

    expect(
      resolveDiscordBindingOwnerKey({
        connectionMode: "shared",
        botUserId: "123456789"
      })
    ).toBe("shared:123456789");
  });

  it("returns null when the binding has no valid bot user id", () => {
    expect(resolveDiscordBindingOwnerKey({ connectionMode: "custom" })).toBeNull();
    expect(resolveDiscordBindingOwnerKey({ botUserId: "not-a-snowflake" })).toBeNull();
  });
});

describe("hasDiscordBindingOwnerChanged", () => {
  it("detects bot ownership changes across bot ids and connection modes", () => {
    expect(
      hasDiscordBindingOwnerChanged(
        { connectionMode: "custom", botUserId: "111" },
        { connectionMode: "custom", botUserId: "222" }
      )
    ).toBe(true);

    expect(
      hasDiscordBindingOwnerChanged(
        { connectionMode: "custom", botUserId: "111" },
        { connectionMode: "shared", botUserId: "111" }
      )
    ).toBe(true);

    expect(
      hasDiscordBindingOwnerChanged(
        { connectionMode: "shared", botUserId: "111" },
        { connectionMode: "shared", botUserId: "111" }
      )
    ).toBe(false);
  });
});

describe("shouldRejectDiscordInboundForBinding", () => {
  it("rejects messages when the binding no longer matches the expected connection mode", () => {
    expect(
      shouldRejectDiscordInboundForBinding({
        bindingConfigJson: {
          connectionMode: "custom",
          botUserId: "111"
        },
        expectedConnectionMode: "shared",
        receivedByBotUserId: "111"
      })
    ).toBe(true);
  });

  it("rejects messages delivered to a stale bot session", () => {
    expect(
      shouldRejectDiscordInboundForBinding({
        bindingConfigJson: {
          connectionMode: "custom",
          botUserId: "222"
        },
        expectedConnectionMode: "custom",
        receivedByBotUserId: "111"
      })
    ).toBe(true);
  });

  it("allows messages when the binding still belongs to the active bot", () => {
    expect(
      shouldRejectDiscordInboundForBinding({
        bindingConfigJson: {
          connectionMode: "shared",
          botUserId: "111"
        },
        expectedConnectionMode: "shared",
        receivedByBotUserId: "111"
      })
    ).toBe(false);
  });
});

describe("clearDiscordConnectorRoutingState", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const client = {
    query: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset();
    client.query.mockResolvedValue(buildRowsResult([]));
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
  });

  it("clears message links while keeping threads", async () => {
    await clearDiscordConnectorRoutingState("binding-1");

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM connector_message_links cml"),
      ["binding-1"]
    );
  });
});

describe("syncSharedDiscordBindingBotIdentity", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const client = {
    query: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset();
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
  });

  it("updates shared bindings and resets routing only for bindings whose owner changed", async () => {
    client.query
      .mockResolvedValueOnce(buildRowsResult([
        {
          id: "binding-1",
          config_json: {
            connectionMode: "shared",
            botUserId: "111"
          }
        },
        {
          id: "binding-2",
          config_json: {
            connectionMode: "shared",
            botUserId: "222"
          }
        }
      ]))
      .mockResolvedValue(buildRowsResult([]));

    await syncSharedDiscordBindingBotIdentity("222");

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET config_json = $2::jsonb"),
      ["binding-1", JSON.stringify({
        connectionMode: "shared",
        botUserId: "222"
      })]
    );
    const deleteCalls = client.query.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes("DELETE FROM connector_message_links cml")
    );
    const updateCalls = client.query.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes("SET config_json = $2::jsonb")
    );

    expect(updateCalls).toHaveLength(1);
    expect(deleteCalls).toHaveLength(1);
    expect(updateCalls[0]?.[1]).toEqual(["binding-1", JSON.stringify({
      connectionMode: "shared",
      botUserId: "222"
    })]);
    expect(deleteCalls[0]?.[1]).toEqual(["binding-1"]);
  });
});

describe("syncDiscordBindingBotIdentityIfChanged", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const client = {
    query: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset();
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
  });

  it("updates the binding and clears routing state when the bot owner changed", async () => {
    client.query.mockResolvedValue(buildRowsResult([]));

    const nextConfigJson = await syncDiscordBindingBotIdentityIfChanged({
      bindingId: "binding-3",
      currentConfigJson: {
        connectionMode: "shared",
        botUserId: "111"
      },
      activeBotUserId: "222"
    });

    expect(nextConfigJson).toEqual({
      connectionMode: "shared",
      botUserId: "222"
    });
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SET config_json = $2::jsonb"),
      ["binding-3", JSON.stringify({
        connectionMode: "shared",
        botUserId: "222"
      })]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("DELETE FROM connector_message_links cml"),
      ["binding-3"]
    );
  });

  it("is a no-op when the binding already matches the active bot", async () => {
    const nextConfigJson = await syncDiscordBindingBotIdentityIfChanged({
      bindingId: "binding-4",
      currentConfigJson: {
        connectionMode: "shared",
        botUserId: "222"
      },
      activeBotUserId: "222"
    });

    expect(nextConfigJson).toEqual({
      connectionMode: "shared",
      botUserId: "222"
    });
    expect(client.query).not.toHaveBeenCalled();
  });
});
