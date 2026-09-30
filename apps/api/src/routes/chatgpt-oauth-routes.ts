import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import {
  disconnectUserChatGptAuth,
  pollChatGptDeviceAuth,
  startChatGptDeviceAuth,
  updateUserChatGptForcedModel
} from "../services/billing/chatgpt-oauth.js";
import { getUserByoConfig } from "../services/billing/subscriptions.js";

const pollDeviceAuthSchema = z.object({
  deviceAuthId: z.string().min(1).max(200),
  userCode: z.string().min(1).max(200)
});

const updateChatGptModelSchema = z.object({
  model: z.string().max(300).nullable()
});

export const chatgptOauthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/api/subscription/byo/chatgpt/device/start", { preHandler: fastify.authenticate }, async () => {
    return startChatGptDeviceAuth();
  });

  fastify.post("/api/subscription/byo/chatgpt/device/poll", { preHandler: fastify.authenticate }, async (request) => {
    const body = pollDeviceAuthSchema.parse(request.body);
    const result = await pollChatGptDeviceAuth(request.user.id, body.deviceAuthId, body.userCode);
    const byo = await getUserByoConfig(request.user.id);

    return {
      result,
      byo
    };
  });

  fastify.post("/api/subscription/byo/chatgpt/disconnect", { preHandler: fastify.authenticate }, async (request) => {
    await disconnectUserChatGptAuth(request.user.id);
    const byo = await getUserByoConfig(request.user.id);

    return {
      ok: true,
      byo
    };
  });

  fastify.patch("/api/subscription/byo/chatgpt/force-model", { preHandler: fastify.authenticate }, async (request) => {
    const body = updateChatGptModelSchema.parse(request.body);
    await updateUserChatGptForcedModel(request.user.id, body.model);
    const byo = await getUserByoConfig(request.user.id);

    return {
      ok: true,
      byo
    };
  });
};
