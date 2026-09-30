import type { PoolClient } from "pg";
import {
  Client,
  GatewayIntentBits,
  Partials,
  type Message
} from "discord.js";
import { config } from "../../../lib/config.js";
import { pool, query } from "../../../lib/db.js";
import {
  getDiscordBindingById,
  processDiscordMessageForBinding,
  type DiscordMessage
} from "./index.js";
import { processSharedDiscordMessage } from "./discord-shared.js";
import { getSharedConnectorTokenIfEnabled } from "../shared-connectors.js";

const RECONCILE_INTERVAL_MS = 15_000;
const DISCORD_SHARED_SESSION_ID = "shared:discord";

interface GatewayLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface DiscordGatewayBindingRow {
  id: string;
  status: string;
  config_json: Record<string, unknown>;
}

interface DiscordGatewayBindingConfig {
  botToken: string | null;
}

interface ActiveDiscordGatewaySession {
  bindingId: string;
  botToken: string;
  client: Client;
  lockClient: PoolClient;
  lockKey: string;
  stopping: boolean;
}

type LockClientErrorHandler = (session: ActiveDiscordGatewaySession, error: unknown) => void;

function normalizeDiscordSnowflake(input: unknown): string | null {
  if (typeof input !== "string" || !/^\d+$/.test(input)) {
    return null;
  }

  return input;
}

function parseDiscordGatewayBindingConfig(configJson: Record<string, unknown>): DiscordGatewayBindingConfig {
  const rawBotToken = configJson.botToken;
  const botToken =
    typeof rawBotToken === "string" && rawBotToken.trim().length > 0
      ? rawBotToken.trim()
      : null;

  return {
    botToken
  };
}

function isPgConnectionTerminationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { code?: unknown; message?: unknown };
  if (typeof maybe.code === "string" && maybe.code === "57P01") {
    return true;
  }
  if (typeof maybe.message !== "string") {
    return false;
  }

  const lowered = maybe.message.toLowerCase();
  return lowered.includes("terminating connection") || lowered.includes("connection terminated unexpectedly");
}

function toDiscordInboundMessage(message: Message): DiscordMessage | null {
  const messageId = normalizeDiscordSnowflake(message.id);
  const channelId = normalizeDiscordSnowflake(message.channelId);
  const authorId = normalizeDiscordSnowflake(message.author?.id);
  const guildId = normalizeDiscordSnowflake(message.guildId ?? undefined);
  const replyMessageId = normalizeDiscordSnowflake(message.reference?.messageId ?? undefined);

  if (!messageId || !channelId || !authorId) {
    return null;
  }

  return {
    id: messageId,
    channel_id: channelId,
    guild_id: guildId ?? undefined,
    timestamp: message.createdAt.toISOString(),
    content: typeof message.content === "string" ? message.content : "",
    author: {
      id: authorId,
      username: message.author?.username,
      global_name: message.author?.globalName ?? null,
      bot: message.author?.bot === true
    },
    mentions: [...message.mentions.users.values()].map((mentionedUser) => ({
      id: mentionedUser.id
    })),
    message_reference: replyMessageId
      ? {
          message_id: replyMessageId
        }
      : undefined,
    // Best effort: only replies to recently seen messages carry their text.
    referenced_message: replyMessageId
      ? { content: message.channel.messages.cache.get(replyMessageId)?.content }
      : undefined,
    attachments: [...message.attachments.values()].map((attachment) => ({
      url: attachment.url,
      filename: attachment.name ?? undefined,
      content_type: attachment.contentType ?? undefined
    }))
  };
}

async function listActiveDiscordBindings(): Promise<DiscordGatewayBindingRow[]> {
  const result = await query<DiscordGatewayBindingRow>(
    `SELECT id, status, config_json
       FROM connector_bindings
      WHERE type = 'discord'
        AND status = 'active'
        AND COALESCE(config_json->>'connectionMode', 'custom') = 'custom'`
  );

  return result.rows;
}

async function tryAcquireBindingLock(bindingId: string): Promise<{ client: PoolClient; key: string } | null> {
  const lockKey = `discord_gateway_binding:${bindingId}`;
  const client = await pool.connect();
  try {
    const lockRes = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [lockKey]
    );

    if (!lockRes.rows[0]?.locked) {
      client.release();
      return null;
    }

    return {
      client,
      key: lockKey
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

async function releaseBindingLock(lockClient: PoolClient, lockKey: string): Promise<void> {
  try {
    await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]);
  } catch (error) {
    if (!isPgConnectionTerminationError(error)) {
      throw error;
    }
  } finally {
    lockClient.release();
  }
}

async function startBindingSession(
  binding: DiscordGatewayBindingRow,
  logger: GatewayLogger,
  onLockClientError: LockClientErrorHandler
): Promise<ActiveDiscordGatewaySession | null> {
  const parsedConfig = parseDiscordGatewayBindingConfig(binding.config_json);
  if (!parsedConfig.botToken) {
    logger.warn({ bindingId: binding.id }, "Skipping Discord gateway start: missing bot token");
    return null;
  }

  const acquiredLock = await tryAcquireBindingLock(binding.id);
  if (!acquiredLock) {
    return null;
  }

  const preSessionLockErrorHandler = (error: Error) => {
    logger.error(
      { bindingId: binding.id, error: error.message },
      "Discord gateway DB lock connection lost before session bootstrap completed"
    );
  };
  acquiredLock.client.on("error", preSessionLockErrorHandler);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  client.on("messageCreate", async (message) => {
    if (message.author?.bot) {
      return;
    }

    const inboundMessage = toDiscordInboundMessage(message);
    if (!inboundMessage) {
      return;
    }

    try {
      const freshBinding = await getDiscordBindingById(binding.id);
      if (!freshBinding || freshBinding.status !== "active") {
        return;
      }

      await processDiscordMessageForBinding(freshBinding, inboundMessage, {
        receivedByBotUserId: client.user?.id ?? null
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      logger.error(
        { bindingId: binding.id, messageId: message.id, error: details },
        "Failed to process Discord message"
      );
    }
  });

  client.on("error", (error) => {
    logger.error(
      { bindingId: binding.id, error: error instanceof Error ? error.message : String(error) },
      "Discord gateway client error"
    );
  });

  client.once("ready", () => {
    logger.info(
      { bindingId: binding.id, botUserId: client.user?.id ?? null },
      "Discord gateway connected"
    );
  });

  try {
    await client.login(parsedConfig.botToken);
  } catch (error) {
    client.destroy();
    acquiredLock.client.off("error", preSessionLockErrorHandler);
    await releaseBindingLock(acquiredLock.client, acquiredLock.key);
    const details = error instanceof Error ? error.message : String(error);
    logger.error({ bindingId: binding.id, error: details }, "Discord gateway login failed");
    return null;
  }

  const session: ActiveDiscordGatewaySession = {
    bindingId: binding.id,
    botToken: parsedConfig.botToken,
    client,
    lockClient: acquiredLock.client,
    lockKey: acquiredLock.key,
    stopping: false
  };

  session.lockClient.once("error", (error) => {
    onLockClientError(session, error);
  });
  session.lockClient.off("error", preSessionLockErrorHandler);

  return session;
}

async function startSharedDiscordSession(
  logger: GatewayLogger,
  onLockClientError: LockClientErrorHandler
): Promise<ActiveDiscordGatewaySession | null> {
  const sharedToken = await getSharedConnectorTokenIfEnabled("discord");
  if (!sharedToken?.botToken) {
    return null;
  }

  const acquiredLock = await tryAcquireBindingLock(DISCORD_SHARED_SESSION_ID);
  if (!acquiredLock) {
    return null;
  }

  const preSessionLockErrorHandler = (error: Error) => {
    logger.error(
      { bindingId: DISCORD_SHARED_SESSION_ID, error: error.message },
      "Discord shared gateway DB lock connection lost before session bootstrap completed"
    );
  };
  acquiredLock.client.on("error", preSessionLockErrorHandler);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  client.on("messageCreate", async (message) => {
    if (message.author?.bot) {
      return;
    }

    const inboundMessage = toDiscordInboundMessage(message);
    if (!inboundMessage) {
      return;
    }

    try {
      const freshToken = await getSharedConnectorTokenIfEnabled("discord");
      if (!freshToken?.botToken) {
        return;
      }

      await processSharedDiscordMessage({
        message: inboundMessage,
        sharedBotToken: freshToken.botToken,
        sharedBotUserId: freshToken.botUserId
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      logger.error(
        { bindingId: DISCORD_SHARED_SESSION_ID, messageId: message.id, error: details },
        "Failed to process shared Discord message"
      );
    }
  });

  client.on("error", (error) => {
    logger.error(
      { bindingId: DISCORD_SHARED_SESSION_ID, error: error instanceof Error ? error.message : String(error) },
      "Discord shared gateway client error"
    );
  });

  client.once("ready", () => {
    logger.info(
      { bindingId: DISCORD_SHARED_SESSION_ID, botUserId: client.user?.id ?? null },
      "Discord shared gateway connected"
    );
  });

  try {
    await client.login(sharedToken.botToken);
  } catch (error) {
    client.destroy();
    acquiredLock.client.off("error", preSessionLockErrorHandler);
    await releaseBindingLock(acquiredLock.client, acquiredLock.key);
    const details = error instanceof Error ? error.message : String(error);
    logger.error({ bindingId: DISCORD_SHARED_SESSION_ID, error: details }, "Discord shared gateway login failed");
    return null;
  }

  const session: ActiveDiscordGatewaySession = {
    bindingId: DISCORD_SHARED_SESSION_ID,
    botToken: sharedToken.botToken,
    client,
    lockClient: acquiredLock.client,
    lockKey: acquiredLock.key,
    stopping: false
  };

  session.lockClient.once("error", (error) => {
    onLockClientError(session, error);
  });
  session.lockClient.off("error", preSessionLockErrorHandler);

  return session;
}

async function stopBindingSession(session: ActiveDiscordGatewaySession): Promise<void> {
  if (session.stopping) {
    return;
  }
  session.stopping = true;
  session.lockClient.removeAllListeners("error");
  session.client.removeAllListeners();
  session.client.destroy();
  await releaseBindingLock(session.lockClient, session.lockKey);
}

export function startDiscordGatewayLoop(logger: GatewayLogger): () => void {
  if (!config.connectors.discord.enabled) {
    logger.info("Discord connector disabled; gateway loop not started");
    return () => {
      // noop
    };
  }

  const sessions = new Map<string, ActiveDiscordGatewaySession>();
  let sharedSession: ActiveDiscordGatewaySession | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let reconcileInFlight = false;

  const restartSessionFromLockError: LockClientErrorHandler = (session, error) => {
    const details = error instanceof Error ? error.message : String(error);
    logger.error(
      { bindingId: session.bindingId, error: details },
      "Discord gateway DB lock connection lost; restarting session"
    );

    void (async () => {
      if (session.bindingId === DISCORD_SHARED_SESSION_ID) {
        if (sharedSession === session) {
          sharedSession = null;
        }
      } else {
        const current = sessions.get(session.bindingId);
        if (current === session) {
          sessions.delete(session.bindingId);
        }
      }

      await stopBindingSession(session).catch((stopError) => {
        const stopDetails = stopError instanceof Error ? stopError.message : String(stopError);
        logger.error(
          { bindingId: session.bindingId, error: stopDetails },
          "Failed to stop Discord gateway session after DB lock error"
        );
      });

      if (stopped) {
        return;
      }

      await reconcile().catch((reconcileError) => {
        const reconcileDetails = reconcileError instanceof Error ? reconcileError.message : String(reconcileError);
        logger.error(
          { bindingId: session.bindingId, error: reconcileDetails },
          "Failed to reconcile Discord gateway after DB lock error"
        );
      });
    })();
  };

  const reconcile = async () => {
    if (stopped || reconcileInFlight) {
      return;
    }

    reconcileInFlight = true;
    try {
      const activeBindings = await listActiveDiscordBindings();
      const byId = new Map(activeBindings.map((binding) => [binding.id, binding]));

      for (const [bindingId, session] of sessions.entries()) {
        const currentBinding = byId.get(bindingId);
        const currentToken = currentBinding
          ? parseDiscordGatewayBindingConfig(currentBinding.config_json).botToken
          : null;

        if (!currentBinding || !currentToken || currentToken !== session.botToken) {
          sessions.delete(bindingId);
          await stopBindingSession(session).catch((error) => {
            const details = error instanceof Error ? error.message : String(error);
            logger.error({ bindingId, error: details }, "Failed to stop Discord gateway session");
          });
        }
      }

      for (const binding of activeBindings) {
        if (sessions.has(binding.id)) {
          continue;
        }

        const startedSession = await startBindingSession(binding, logger, restartSessionFromLockError).catch((error) => {
          const details = error instanceof Error ? error.message : String(error);
          logger.error(
            { bindingId: binding.id, error: details },
            "Failed to start Discord gateway session"
          );
          return null;
        });

        if (startedSession) {
          sessions.set(binding.id, startedSession);
        }
      }

      const sharedToken = await getSharedConnectorTokenIfEnabled("discord");
      if (!sharedToken?.botToken && sharedSession) {
        const currentSharedSession = sharedSession;
        sharedSession = null;
        await stopBindingSession(currentSharedSession).catch((error) => {
          const details = error instanceof Error ? error.message : String(error);
          logger.error(
            { bindingId: DISCORD_SHARED_SESSION_ID, error: details },
            "Failed to stop shared Discord gateway session"
          );
        });
      } else if (sharedToken?.botToken && sharedSession && sharedSession.botToken !== sharedToken.botToken) {
        const currentSharedSession = sharedSession;
        sharedSession = null;
        await stopBindingSession(currentSharedSession).catch((error) => {
          const details = error instanceof Error ? error.message : String(error);
          logger.error(
            { bindingId: DISCORD_SHARED_SESSION_ID, error: details },
            "Failed to restart shared Discord gateway session after token change"
          );
        });
      }

      if (sharedToken?.botToken && !sharedSession) {
        const startedSharedSession = await startSharedDiscordSession(logger, restartSessionFromLockError).catch((error) => {
          const details = error instanceof Error ? error.message : String(error);
          logger.error(
            { bindingId: DISCORD_SHARED_SESSION_ID, error: details },
            "Failed to start shared Discord gateway session"
          );
          return null;
        });

        if (startedSharedSession) {
          sharedSession = startedSharedSession;
        }
      }
    } finally {
      reconcileInFlight = false;
    }
  };

  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(async () => {
      await reconcile().catch((error) => {
        const details = error instanceof Error ? error.message : String(error);
        logger.error({ error: details }, "Discord gateway reconcile failed");
      });
      schedule();
    }, RECONCILE_INTERVAL_MS);
  };

  void reconcile().catch((error) => {
    const details = error instanceof Error ? error.message : String(error);
    logger.error({ error: details }, "Discord gateway initial reconcile failed");
  });
  schedule();
  logger.info("Discord gateway loop started");

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    for (const [bindingId, session] of sessions.entries()) {
      sessions.delete(bindingId);
      void stopBindingSession(session).catch((error) => {
        const details = error instanceof Error ? error.message : String(error);
        logger.error(
          { bindingId, error: details },
          "Failed to stop Discord gateway session during shutdown"
        );
      });
    }
    if (sharedSession) {
      const currentSharedSession = sharedSession;
      sharedSession = null;
      void stopBindingSession(currentSharedSession).catch((error) => {
        const details = error instanceof Error ? error.message : String(error);
        logger.error(
          { bindingId: DISCORD_SHARED_SESSION_ID, error: details },
          "Failed to stop shared Discord gateway session during shutdown"
        );
      });
    }

    logger.info("Discord gateway loop stopped");
  };
}
