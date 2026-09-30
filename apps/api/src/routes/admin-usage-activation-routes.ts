import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { usageActivationInputSchema } from "@meowbert/shared";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import { listUsageActivationSchedules, saveUsageActivationSchedule, removeUsageActivationSchedule }
  from "../services/admin/admin-usage-activation.js";

const scheduleParams = z.object({ scheduleId: z.string().uuid() });
const path = "/api/admin/utilities/usage-activation";

export function registerAdminUsageActivationRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get(path, { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return { schedules: await listUsageActivationSchedules() };
  });
  fastify.post(path, { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const input = usageActivationInputSchema.parse(request.body);
    return reply.code(201).send({ schedule: await saveUsageActivationSchedule(input) });
  });
  fastify.patch(`${path}/:scheduleId`, { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { scheduleId } = scheduleParams.parse(request.params);
    const input = usageActivationInputSchema.parse(request.body);
    return { schedule: await saveUsageActivationSchedule(input, scheduleId) };
  });
  fastify.delete(`${path}/:scheduleId`, { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const { scheduleId } = scheduleParams.parse(request.params);
    await removeUsageActivationSchedule(scheduleId);
    return reply.code(204).send();
  });
}
