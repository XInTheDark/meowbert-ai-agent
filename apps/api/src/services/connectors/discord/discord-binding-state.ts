import type { PoolClient } from "pg";
import { withTransaction } from "../../../lib/db.js";

export type DiscordConnectionMode = "custom" | "shared";

interface DiscordBindingConfigRow {
  id: string;
  config_json: Record<string, unknown>;
}

function normalizeDiscordSnowflake(input: unknown): string | null {
  if (typeof input !== "string" || !/^\d+$/.test(input)) {
    return null;
  }

  return input;
}

export function resolveDiscordConnectionMode(configJson: Record<string, unknown>): DiscordConnectionMode {
  return configJson.connectionMode === "shared" ? "shared" : "custom";
}

export function resolveDiscordBindingOwnerKey(configJson: Record<string, unknown>): string | null {
  const botUserId = normalizeDiscordSnowflake(configJson.botUserId);
  if (!botUserId) {
    return null;
  }

  return `${resolveDiscordConnectionMode(configJson)}:${botUserId}`;
}

export function hasDiscordBindingOwnerChanged(
  previousConfigJson: Record<string, unknown> | null | undefined,
  nextConfigJson: Record<string, unknown>
): boolean {
  const previousOwnerKey =
    previousConfigJson && typeof previousConfigJson === "object"
      ? resolveDiscordBindingOwnerKey(previousConfigJson)
      : null;

  return previousOwnerKey !== resolveDiscordBindingOwnerKey(nextConfigJson);
}

export function shouldRejectDiscordInboundForBinding(input: {
  bindingConfigJson: Record<string, unknown>;
  expectedConnectionMode?: DiscordConnectionMode;
  receivedByBotUserId?: string | null;
}): boolean {
  if (
    input.expectedConnectionMode
    && resolveDiscordConnectionMode(input.bindingConfigJson) !== input.expectedConnectionMode
  ) {
    return true;
  }

  const configuredBotUserId = normalizeDiscordSnowflake(input.bindingConfigJson.botUserId);
  const receivedByBotUserId = normalizeDiscordSnowflake(input.receivedByBotUserId);

  if (configuredBotUserId && receivedByBotUserId && configuredBotUserId !== receivedByBotUserId) {
    return true;
  }

  return false;
}

async function clearDiscordConnectorRoutingStateInTx(client: PoolClient, bindingId: string): Promise<void> {
  await client.query(
    `DELETE FROM connector_message_links cml
      USING connector_threads ct
      WHERE cml.thread_id = ct.id
        AND ct.binding_id = $1`,
    [bindingId]
  );
}

async function syncDiscordBindingBotIdentityIfChangedInTx(
  client: PoolClient,
  input: {
    bindingId: string;
    currentConfigJson: Record<string, unknown>;
    activeBotUserId: string | null;
  }
): Promise<Record<string, unknown>> {
  const nextConfigJson: Record<string, unknown> = {
    ...input.currentConfigJson,
    botUserId: input.activeBotUserId
  };

  if (!hasDiscordBindingOwnerChanged(input.currentConfigJson, nextConfigJson)) {
    return input.currentConfigJson;
  }

  await client.query(
    `UPDATE connector_bindings
        SET config_json = $2::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [input.bindingId, JSON.stringify(nextConfigJson)]
  );

  await clearDiscordConnectorRoutingStateInTx(client, input.bindingId);

  return nextConfigJson;
}

export async function clearDiscordConnectorRoutingState(
  bindingId: string,
  client?: PoolClient
): Promise<void> {
  if (client) {
    await clearDiscordConnectorRoutingStateInTx(client, bindingId);
    return;
  }

  await withTransaction(async (tx) => {
    await clearDiscordConnectorRoutingStateInTx(tx, bindingId);
  });
}

export async function syncDiscordBindingBotIdentityIfChanged(input: {
  bindingId: string;
  currentConfigJson: Record<string, unknown>;
  activeBotUserId: string | null;
  client?: PoolClient;
}): Promise<Record<string, unknown>> {
  if (input.client) {
    return syncDiscordBindingBotIdentityIfChangedInTx(input.client, input);
  }

  return withTransaction((client) => syncDiscordBindingBotIdentityIfChangedInTx(client, input));
}

export async function syncSharedDiscordBindingBotIdentity(activeBotUserId: string | null): Promise<void> {
  await withTransaction(async (client) => {
    const bindingRes = await client.query<DiscordBindingConfigRow>(
      `SELECT id, config_json
         FROM connector_bindings
        WHERE type = 'discord'
          AND COALESCE(config_json->>'connectionMode', 'custom') = 'shared'
        FOR UPDATE`
    );

    for (const binding of bindingRes.rows) {
      await syncDiscordBindingBotIdentityIfChangedInTx(client, {
        bindingId: binding.id,
        currentConfigJson: binding.config_json,
        activeBotUserId
      });
    }
  });
}
