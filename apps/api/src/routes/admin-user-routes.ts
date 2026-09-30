import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { query } from "../lib/db.js";
import {
  changeUserPassword,
  deleteUser,
  getUsers,
  setUserTokenUsage,
  updateUser,
  updateUserSignupApproval
} from "../services/admin/admin-users.js";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import { signSessionToken } from "../services/auth/session-tokens.js";
import { replaceUserSubscriptionPlans } from "../services/billing/subscriptions.js";
import { ensureUserHasWorkspace } from "../services/workspaces/user-workspace.js";

const getUsersSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional()
});

const updateUserLimitSchema = z.object({
  limit: z.number().min(1)
});

const updateUserResourcesSchema = z.object({
  workspaceLimit: z.number().int().min(1).nullable(),
  sandboxPidsLimit: z.number().int().min(1).nullable(),
  sandboxMemoryMb: z.number().int().min(1).nullable(),
  sandboxCpus: z.number().positive().nullable(),
  workspaceStorageMb: z.number().int().min(1).nullable(),
  persistentRuntimeComputeCredits: z.number().int().min(0).nullable(),
  persistentRuntimeLimit: z.number().int().min(0).nullable()
});

const updateUserAdminSchema = z.object({
  isSuperAdmin: z.boolean()
});

const updateUserActiveSchema = z.object({
  isActive: z.boolean()
});

const updateUserRateLimitSchema = z.object({
  freeMessageLimit: z.number().int().min(0).nullable()
});

const setUserUsageSchema = z.object({
  usage: z.number().int().min(0)
});

const updateUserApprovalSchema = z.object({
  decision: z.enum(["approve", "reject"])
});

const replaceUserSubscriptionPlansSchema = z.object({
  planIds: z.array(z.string().uuid()).max(100)
});

const changePasswordSchema = z.object({
  password: z.string().min(8)
});

function registerAdminUserResourceRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/users", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const query = getUsersSchema.parse(request.query);
    return getUsers(query);
  });

  fastify.patch("/api/admin/users/:userId/limit", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const { limit } = updateUserLimitSchema.parse(request.body);
    return updateUser(userId, { workspaceLimit: limit });
  });

  fastify.patch("/api/admin/users/:userId/resources", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const body = updateUserResourcesSchema.parse(request.body);
    return updateUser(userId, {
      workspaceLimit: body.workspaceLimit,
      sandboxPidsLimit: body.sandboxPidsLimit,
      sandboxMemoryMb: body.sandboxMemoryMb,
      sandboxCpus: body.sandboxCpus,
      workspaceStorageMb: body.workspaceStorageMb,
      persistentRuntimeComputeCredits: body.persistentRuntimeComputeCredits,
      persistentRuntimeLimit: body.persistentRuntimeLimit
    });
  });
}

function registerAdminUserLimitRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.patch("/api/admin/users/:userId/admin", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const { isSuperAdmin } = updateUserAdminSchema.parse(request.body);
    return updateUser(userId, { isSuperAdmin });
  });

  fastify.patch("/api/admin/users/:userId/active", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const { isActive } = updateUserActiveSchema.parse(request.body);
    return updateUser(userId, { isActive });
  });

  fastify.patch("/api/admin/users/:userId/rate-limit", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const { freeMessageLimit } = updateUserRateLimitSchema.parse(request.body);
    return updateUser(userId, { freeMessageLimit });
  });

  fastify.patch("/api/admin/users/:userId/free-message-limit", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const { freeMessageLimit } = updateUserRateLimitSchema.parse(request.body);
    return updateUser(userId, { freeMessageLimit });
  });

  fastify.patch("/api/admin/users/:userId/usage", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const { usage } = setUserUsageSchema.parse(request.body);
    return setUserTokenUsage({
      userId,
      targetUsage: usage,
      adjustedByUserId: request.user.id
    });
  });

  fastify.patch("/api/admin/users/:userId/monthly-usage", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const { usage } = setUserUsageSchema.parse(request.body);
    return setUserTokenUsage({
      userId,
      targetUsage: usage,
      adjustedByUserId: request.user.id
    });
  });
}

function registerAdminUserLifecycleRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.patch("/api/admin/users/:userId/approval", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const { decision } = updateUserApprovalSchema.parse(request.body);
    const updated = await updateUserSignupApproval({
      userId,
      decision,
      actorUserId: request.user.id
    });
    if (decision === "approve" && updated.isActive) {
      await ensureUserHasWorkspace(userId);
    }
    return updated;
  });

  fastify.put("/api/admin/users/:userId/subscriptions", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const body = replaceUserSubscriptionPlansSchema.parse(request.body);
    const subscriptions = await replaceUserSubscriptionPlans({
      userId,
      planIds: body.planIds,
      assignedByUserId: request.user.id
    });
    return { subscriptions };
  });

  fastify.patch("/api/admin/users/:userId/password", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    const { password } = changePasswordSchema.parse(request.body);
    await changeUserPassword(userId, password);
    return { ok: true };
  });

  fastify.delete("/api/admin/users/:userId", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };
    if (userId === request.user.id) {
      return reply.status(400).send({ error: "Cannot delete your own account" });
    }
    await deleteUser(userId);
    return { ok: true };
  });

  fastify.post("/api/admin/users/:userId/impersonate", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const { userId } = request.params as { userId: string };

    const userRes = await query<{
      id: string;
      email: string;
      is_active: boolean;
      signup_approval_status: "approved" | "pending" | "rejected";
      email_verified_at: string | null;
    }>(
      `SELECT id,
              email,
              is_active,
              signup_approval_status,
              email_verified_at::text
         FROM users
        WHERE id = $1`,
      [userId]
    );

    if (userRes.rowCount === 0) {
      return reply.status(404).send({ error: "User not found" });
    }

    const user = userRes.rows[0];
    if (!user.is_active || user.signup_approval_status !== "approved" || !user.email_verified_at) {
      return reply.status(403).send({ error: "Cannot impersonate an inactive user" });
    }

    const token = await signSessionToken(reply, { id: user.id, email: user.email });

    return { token };
  });
}

export function registerAdminUserRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  registerAdminUserResourceRoutes(fastify);
  registerAdminUserLimitRoutes(fastify);
  registerAdminUserLifecycleRoutes(fastify);
}
