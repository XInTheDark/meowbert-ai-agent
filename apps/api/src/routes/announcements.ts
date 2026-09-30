import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import { query } from "../lib/db.js";

const announcementBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  notify: z.boolean()
});

const announcementParams = z.object({ announcementId: z.string().uuid() });

export const announcementRoutes: FastifyPluginAsync = async (fastify) => {
  // Public — all users can list announcements
  fastify.get("/api/announcements", async () => {
    const result = await query<{
      id: string;
      title: string;
      body: string;
      notify: boolean;
      created_at: string;
    }>(
      "SELECT id, title, body, notify, created_at FROM announcements ORDER BY created_at DESC"
    );
    return { announcements: result.rows };
  });

  // Admin — create
  fastify.post("/api/admin/announcements", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const { title, body, notify } = announcementBody.parse(request.body);
    const result = await query<{ id: string }>(
      "INSERT INTO announcements (title, body, notify) VALUES ($1, $2, $3) RETURNING id",
      [title, body, notify]
    );
    return reply.code(201).send({ id: result.rows[0].id });
  });

  // Admin — update
  fastify.patch("/api/admin/announcements/:announcementId", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const { announcementId } = announcementParams.parse(request.params);
    const { title, body, notify } = announcementBody.parse(request.body);
    await query(
      "UPDATE announcements SET title = $1, body = $2, notify = $3, updated_at = now() WHERE id = $4",
      [title, body, notify, announcementId]
    );
    return reply.code(204).send();
  });

  // Admin — delete
  fastify.delete("/api/admin/announcements/:announcementId", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const { announcementId } = announcementParams.parse(request.params);
    await query("DELETE FROM announcements WHERE id = $1", [announcementId]);
    return reply.code(204).send();
  });
};
