import type { FastifyPluginAsync } from "fastify";
import { listConnectorsRoute } from "./list.js";
import { telegramConnectorRoutes } from "./telegram.js";
import { discordConnectorRoutes } from "./discord.js";
import { githubConnectorRoutes } from "./github.js";
import { emailConnectorRoutes } from "./email.js";
import { pairingRoutes } from "./pairing.js";

export const connectorRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listConnectorsRoute);
  await fastify.register(telegramConnectorRoutes);
  await fastify.register(discordConnectorRoutes);
  await fastify.register(githubConnectorRoutes);
  await fastify.register(emailConnectorRoutes);
  await fastify.register(pairingRoutes);
};
