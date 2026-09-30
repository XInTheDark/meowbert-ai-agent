import { config } from "../../../lib/config.js";
import { pool, query } from "../../../lib/db.js";
import {
  getTelegramBindingById,
  processTelegramUpdateForBinding,
  type TelegramUpdate
} from "./index.js";
import { processSharedTelegramUpdate } from "./telegram-shared.js";
import { getSharedConnectorSetting, setSharedTelegramLastUpdateId } from "../shared-connectors.js";

const POLLING_INTERVAL_MS = 3000;
const TELEGRAM_UPDATES_LIMIT = 50;

interface PollingLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

interface TelegramPollingBindingRow {
  id: string;
  config_json: Record<string, unknown>;
}

interface TelegramBindingConfig {
  botToken: string | null;
  mode: "webhook" | "polling";
  lastUpdateId: number | null;
}

function parseTelegramBindingConfig(configJson: Record<string, unknown>): TelegramBindingConfig {
  const rawMode = configJson.mode;
  const mode = rawMode === "polling" ? "polling" : "webhook";

  const rawBotToken = configJson.botToken;
  const botToken = typeof rawBotToken === "string" && rawBotToken.trim().length > 0 ? rawBotToken.trim() : null;

  const rawLastUpdateId = configJson.lastUpdateId;
  const lastUpdateId =
    typeof rawLastUpdateId === "number" && Number.isInteger(rawLastUpdateId) ? rawLastUpdateId : null;

  return { botToken, mode, lastUpdateId };
}

function buildTelegramMethodUrl(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

async function fetchTelegramUpdates(botToken: string, offset?: number): Promise<TelegramUpdate[]> {
  const url = new URL(buildTelegramMethodUrl(botToken, "getUpdates"));
  url.searchParams.set("limit", String(TELEGRAM_UPDATES_LIMIT));
  url.searchParams.set("timeout", "0");
  if (typeof offset === "number") {
    url.searchParams.set("offset", String(offset));
  }

  const response = await fetch(url.toString(), {
    method: "GET"
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Telegram polling returned invalid JSON");
  }

  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    throw new Error("Telegram polling returned an unexpected payload");
  }

  const telegramPayload = payload as TelegramApiResponse<TelegramUpdate[]>;
  if (!response.ok || telegramPayload.ok !== true) {
    const reason = telegramPayload.description ?? `HTTP ${response.status}`;
    throw new Error(`Telegram polling failed: ${reason}`);
  }

  if (!Array.isArray(telegramPayload.result)) {
    return [];
  }

  return telegramPayload.result;
}

async function withBindingAdvisoryLock<T>(
  bindingId: string,
  fn: () => Promise<T>
): Promise<{ acquired: false } | { acquired: true; result: T }> {
  const client = await pool.connect();
  const onClientError = (error: Error) => {
    console.error("[telegram-polling] PostgreSQL advisory-lock client error", error);
  };
  client.on("error", onClientError);
  try {
    const lockRes = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [bindingId]
    );

    if (!lockRes.rows[0]?.locked) {
      return { acquired: false };
    }

    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [bindingId]);
    }
  } finally {
    client.off("error", onClientError);
    client.release();
  }
}

async function updateLastUpdateId(bindingId: string, lastUpdateId: number): Promise<void> {
  await query(
    `UPDATE connector_bindings
        SET config_json = jsonb_set(config_json, '{lastUpdateId}', to_jsonb($2::int), true),
            updated_at = now()
      WHERE id = $1
        AND COALESCE(config_json->>'mode', 'webhook') = 'polling'`,
    [bindingId, lastUpdateId]
  );
}

async function processBindingPolling(
  binding: TelegramPollingBindingRow,
  logger: PollingLogger
): Promise<void> {
  await withBindingAdvisoryLock(binding.id, async () => {
    const freshBinding = await getTelegramBindingById(binding.id);
    if (!freshBinding || freshBinding.status !== "active") {
      return;
    }

    const freshConfig = parseTelegramBindingConfig(freshBinding.config_json);
    if (freshConfig.mode !== "polling") {
      return;
    }

    if (!freshConfig.botToken) {
      logger.warn({ bindingId: binding.id }, "Skipping telegram polling: missing bot token");
      return;
    }

    const offset = typeof freshConfig.lastUpdateId === "number" ? freshConfig.lastUpdateId + 1 : undefined;
    const updates = await fetchTelegramUpdates(freshConfig.botToken, offset);
    if (updates.length === 0) {
      return;
    }

    let highestUpdateId = freshConfig.lastUpdateId ?? null;

    for (const update of updates) {
      const updateId = typeof update.update_id === "number" && Number.isInteger(update.update_id) ? update.update_id : null;

      try {
        await processTelegramUpdateForBinding(freshBinding, update);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          { bindingId: binding.id, updateId, error: message },
          "Failed to process telegram update in polling mode"
        );
        return;
      }

      if (typeof updateId === "number") {
        highestUpdateId = highestUpdateId === null ? updateId : Math.max(highestUpdateId, updateId);
      }
    }

    if (typeof highestUpdateId === "number" && highestUpdateId !== freshConfig.lastUpdateId) {
      await updateLastUpdateId(binding.id, highestUpdateId);
    }
  });
}

async function listPollingBindings(): Promise<TelegramPollingBindingRow[]> {
  const result = await query<TelegramPollingBindingRow>(
    `SELECT id, config_json
       FROM connector_bindings
      WHERE type = 'telegram'
        AND status = 'active'
        AND COALESCE(config_json->>'connectionMode', 'custom') = 'custom'
        AND COALESCE(config_json->>'mode', 'webhook') = 'polling'`
  );

  return result.rows;
}

async function processSharedTelegramPolling(logger: PollingLogger): Promise<void> {
  const sharedSetting = await getSharedConnectorSetting("telegram");
  if (!sharedSetting.enabled || !sharedSetting.hasToken || sharedSetting.telegramIngestMode !== "polling" || !sharedSetting.botToken) {
    return;
  }

  await withBindingAdvisoryLock("telegram_shared_polling", async () => {
    const freshSetting = await getSharedConnectorSetting("telegram");
    if (!freshSetting.enabled || !freshSetting.hasToken || freshSetting.telegramIngestMode !== "polling" || !freshSetting.botToken) {
      return;
    }

    const offset =
      typeof freshSetting.telegramLastUpdateId === "number"
        ? freshSetting.telegramLastUpdateId + 1
        : undefined;
    const updates = await fetchTelegramUpdates(freshSetting.botToken, offset);
    if (updates.length === 0) {
      return;
    }

    let highestUpdateId = freshSetting.telegramLastUpdateId ?? null;
    for (const update of updates) {
      const updateId =
        typeof update.update_id === "number" && Number.isInteger(update.update_id)
          ? update.update_id
          : null;

      try {
        await processSharedTelegramUpdate({
          update,
          sharedBotToken: freshSetting.botToken
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ updateId, error: message }, "Failed to process shared Telegram update in polling mode");
        return;
      }

      if (typeof updateId === "number") {
        highestUpdateId = highestUpdateId === null ? updateId : Math.max(highestUpdateId, updateId);
      }
    }

    if (typeof highestUpdateId === "number" && highestUpdateId !== freshSetting.telegramLastUpdateId) {
      await setSharedTelegramLastUpdateId(highestUpdateId);
    }
  });
}

async function pollTelegramOnce(logger: PollingLogger): Promise<void> {
  const bindings = await listPollingBindings();
  for (const binding of bindings) {
    try {
      await processBindingPolling(binding, logger);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ bindingId: binding.id, error: message }, "Telegram polling failed for binding");
    }
  }

  try {
    await processSharedTelegramPolling(logger);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Shared Telegram polling failed");
  }
}

export function startTelegramPollingLoop(logger: PollingLogger): () => void {
  if (!config.connectors.telegram.enabled) {
    logger.info("Telegram connector disabled; polling loop not started");
    return () => {
      // noop
    };
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let isTickInFlight = false;

  const tick = async () => {
    if (stopped) {
      return;
    }

    if (isTickInFlight) {
      timer = setTimeout(tick, POLLING_INTERVAL_MS);
      return;
    }

    isTickInFlight = true;
    try {
      await pollTelegramOnce(logger);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Telegram polling tick failed");
    } finally {
      isTickInFlight = false;
      if (!stopped) {
        timer = setTimeout(tick, POLLING_INTERVAL_MS);
      }
    }
  };

  timer = setTimeout(tick, POLLING_INTERVAL_MS);
  logger.info("Telegram polling loop started");

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    logger.info("Telegram polling loop stopped");
  };
}
