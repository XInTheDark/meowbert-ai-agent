import type { FastifyPluginAsync } from "fastify";
import { isAllowedWebPushEndpoint } from "@meowbert/shared";
import { z } from "zod";
import {
  getWebPushPublicKey,
  removeWebPushSubscription,
  saveWebPushSubscription
} from "../../services/notifications/web-push-service.js";

const subscribeSchema = z.object({
  endpoint: z.string().url().refine(isAllowedWebPushEndpoint, "Unsupported Web Push endpoint"),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  }),
  notifyOnBackgroundResponses: z.boolean().default(true),
  userAgent: z.string().optional()
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url()
});

export const webPushRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/notifications/web-push/public-key",
    { preHandler: fastify.authenticate },
    async () => {
      return getWebPushPublicKey();
    }
  );

  fastify.post(
    "/api/notifications/web-push/subscribe",
    { preHandler: fastify.authenticate },
    async (request) => {
      const payload = subscribeSchema.parse(request.body);
      await saveWebPushSubscription(request.user.id, payload);
      return { ok: true };
    }
  );

  fastify.post(
    "/api/notifications/web-push/unsubscribe",
    { preHandler: fastify.authenticate },
    async (request) => {
      const payload = unsubscribeSchema.parse(request.body);
      await removeWebPushSubscription(request.user.id, payload.endpoint);
      return { ok: true };
    }
  );
};
