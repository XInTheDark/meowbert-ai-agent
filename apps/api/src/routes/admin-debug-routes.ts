import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertSuperAdmin, getAdminSettings } from "../services/admin/admin-settings.js";
import { buildWastedTurnsReport } from "../services/admin/debug/wasted-turns-report.js";

const wastedTurnsBody = z.object({ target: z.string().trim().min(1).max(2_000) });

async function assertDebugModeEnabled(): Promise<void> {
  const settings = await getAdminSettings();
  if (!settings.debugMode) {
    throw new Error("Debug tools access denied: turn on debug mode first.");
  }
}

export function registerAdminDebugRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.post("/api/admin/debug/wasted-turns", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    await assertDebugModeEnabled();
    const { target } = wastedTurnsBody.parse(request.body);
    return { report: await buildWastedTurnsReport(target) };
  });
}
