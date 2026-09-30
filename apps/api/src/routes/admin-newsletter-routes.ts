import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import {
  createNewsletterCampaign,
  listNewsletterCampaigns,
  sendTrialNewsletter
} from "../services/connectors/email/newsletters.js";

const sendNewsletterSchema = z.object({
  subject: z.string().min(1).max(240),
  body: z.string().min(1).max(200_000),
  bodyFormat: z.enum(["markdown", "html"])
});
const sendTrialNewsletterSchema = sendNewsletterSchema.extend({
  recipientEmails: z.array(z.string().email()).min(1).max(100)
});


export function registerAdminNewsletterRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/newsletters", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const campaigns = await listNewsletterCampaigns({ limit: 20 });
    return { campaigns };
  });

  fastify.post("/api/admin/newsletters/send", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const body = sendNewsletterSchema.parse(request.body);
    const campaign = await createNewsletterCampaign({
      subject: body.subject,
      body: body.body,
      bodyFormat: body.bodyFormat,
      createdByUserId: request.user.id
    });
    return { campaign };
  });

  fastify.post("/api/admin/newsletters/trial", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const body = sendTrialNewsletterSchema.parse(request.body);
    const result = await sendTrialNewsletter({
      subject: body.subject,
      body: body.body,
      bodyFormat: body.bodyFormat,
      recipientEmails: body.recipientEmails
    });
    return result;
  });
}
