import { THEME_MODE_VALUES, normalizeThemeMode } from "@meowbert/shared/themes";
import {
  DEFAULT_MEMORY_ENABLED,
  normalizeTaskPagePreferences,
  type TaskPagePreferences
} from "@meowbert/shared";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { query, withTransaction } from "../lib/db.js";
import { acquireRegistrationGuardLock, getRegistrationAvailability } from "../services/admin/admin-settings.js";
import { ensureUserHasWorkspace } from "../services/workspaces/user-workspace.js";
import { createDefaultProjectForWorkspace } from "../services/workspaces/default-project.js";
import {
  assertPasswordResetSendAllowed,
  assertSignupVerificationSendAllowed,
  consumePasswordResetToken,
  createPasswordResetChallenge,
  createSignupVerificationChallenge,
  passwordResetExpiryMinutes,
  verificationCodeExpiryMinutes,
  verifySignupCode
} from "../services/connectors/email/challenges.js";
import { queuePasswordResetEmail, queueSignupVerificationEmail } from "../services/connectors/email/dispatch.js";
import { verifySignedUserToken } from "../services/connectors/email/tokens.js";
import { invalidateUserSessions, signSessionToken } from "../services/auth/session-tokens.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(80).optional(),
  workspaceName: z.string().min(1).max(80).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const verifySignupCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().trim().min(4).max(12)
});

const resendSignupCodeSchema = z.object({
  email: z.string().email()
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8)
});

const unsubscribeSchema = z.object({
  token: z.string().min(10)
});


type ThemePreferenceValue = (typeof THEME_MODE_VALUES)[number];

const taskAssistantMessageDisplayPreferencesPatchSchema = z.object({
  collapseLongMessages: z.boolean().optional(),
  renderMarkdown: z.boolean().optional(),
  renderCommonHtml: z.boolean().optional(),
  hideCitationMarkers: z.boolean().optional(),
  renderUserMessages: z.boolean().optional(),
  renderLatex: z.boolean().optional(),
  allowSingleDollarLatex: z.boolean().optional(),
  showThoughts: z.boolean().optional(),
  showMessageSummaries: z.boolean().optional(),
  showScrollToBottomButton: z.boolean().optional(),
  showSelectionThreadActions: z.boolean().optional(),
  showSelectionThreadHighlights: z.boolean().optional()
})
  .strict()
  .refine(
    (value) => value.collapseLongMessages !== undefined
      || value.renderMarkdown !== undefined
      || value.renderCommonHtml !== undefined
      || value.hideCitationMarkers !== undefined
      || value.renderUserMessages !== undefined
      || value.renderLatex !== undefined
      || value.allowSingleDollarLatex !== undefined
      || value.showThoughts !== undefined
      || value.showMessageSummaries !== undefined
      || value.showScrollToBottomButton !== undefined
      || value.showSelectionThreadActions !== undefined
      || value.showSelectionThreadHighlights !== undefined,
    { message: "At least one assistant message display setting is required." }
  );

const taskUiPreferencesPatchSchema = z.object({
  enableThreadsPopup: z.boolean().optional(),
  sendWithShiftEnter: z.boolean().optional()
})
  .strict()
  .refine(
    (value) => value.enableThreadsPopup !== undefined || value.sendWithShiftEnter !== undefined,
    { message: "At least one UI preference is required." }
  );

const taskPagePreferencesPatchSchema = z.object({
  assistantMessageDisplay: taskAssistantMessageDisplayPreferencesPatchSchema.optional(),
  ui: taskUiPreferencesPatchSchema.optional()
})
  .strict()
  .refine(
    (value) => value.assistantMessageDisplay !== undefined || value.ui !== undefined,
    { message: "At least one task page preference is required." }
  );

const updatePreferencesSchema = z.object({
  themePreference: z.preprocess((value) => normalizeThemeMode(value) ?? value, z.enum(THEME_MODE_VALUES)).optional(),
  taskPagePreferences: taskPagePreferencesPatchSchema.optional()
})
  .refine(
    (value) => value.themePreference !== undefined || value.taskPagePreferences !== undefined,
    { message: "At least one preference is required." }
  );

function mergeTaskPagePreferences(
  currentValue: unknown,
  patch: z.infer<typeof taskPagePreferencesPatchSchema>
): TaskPagePreferences {
  const current = normalizeTaskPagePreferences(currentValue);
  const nextAssistantMessageDisplay = patch.assistantMessageDisplay
    ? {
        collapseLongMessages:
          patch.assistantMessageDisplay.collapseLongMessages ?? current.assistantMessageDisplay.collapseLongMessages,
        renderMarkdown:
          patch.assistantMessageDisplay.renderMarkdown ?? current.assistantMessageDisplay.renderMarkdown,
        renderCommonHtml:
          patch.assistantMessageDisplay.renderCommonHtml ?? current.assistantMessageDisplay.renderCommonHtml,
        hideCitationMarkers:
          patch.assistantMessageDisplay.hideCitationMarkers ?? current.assistantMessageDisplay.hideCitationMarkers,
        renderUserMessages:
          patch.assistantMessageDisplay.renderUserMessages ?? current.assistantMessageDisplay.renderUserMessages,
        renderLatex:
          patch.assistantMessageDisplay.renderLatex ?? current.assistantMessageDisplay.renderLatex,
        allowSingleDollarLatex:
          patch.assistantMessageDisplay.allowSingleDollarLatex
          ?? current.assistantMessageDisplay.allowSingleDollarLatex,
        showThoughts:
          patch.assistantMessageDisplay.showThoughts ?? current.assistantMessageDisplay.showThoughts,
        showMessageSummaries: patch.assistantMessageDisplay.showMessageSummaries ?? current.assistantMessageDisplay.showMessageSummaries,
        showScrollToBottomButton:
          patch.assistantMessageDisplay.showScrollToBottomButton ?? current.assistantMessageDisplay.showScrollToBottomButton,
        showSelectionThreadActions:
          patch.assistantMessageDisplay.showSelectionThreadActions
          ?? current.assistantMessageDisplay.showSelectionThreadActions,
        showSelectionThreadHighlights:
          patch.assistantMessageDisplay.showSelectionThreadHighlights
          ?? current.assistantMessageDisplay.showSelectionThreadHighlights
      }
    : current.assistantMessageDisplay;
  const nextUi = patch.ui
    ? {
        enableThreadsPopup: patch.ui.enableThreadsPopup ?? current.ui.enableThreadsPopup,
        sendWithShiftEnter: patch.ui.sendWithShiftEnter ?? current.ui.sendWithShiftEnter
      }
    : current.ui;

  return {
    assistantMessageDisplay: nextAssistantMessageDisplay,
    ui: nextUi
  };
}

type RegisterResult =
  | {
      blocked: true;
    }
  | {
      blocked: false;
      pendingEmailVerification: true;
      pendingApproval: boolean;
      user: { id: string; email: string; is_super_admin: boolean };
    }
  | {
      blocked: false;
      pendingEmailVerification: false;
      pendingApproval: true;
      user: { id: string; email: string; is_super_admin: boolean };
    }
  | {
      blocked: false;
      pendingEmailVerification: false;
      pendingApproval: false;
      user: { id: string; email: string; is_super_admin: boolean };
      workspace: { id: string; name: string };
    };

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/auth/registration", async () => {
    const availability = await getRegistrationAvailability();
    return {
      enabled: availability.enabled,
      allowUserSignup: availability.allowUserSignup,
      requireAdminSignupApproval: availability.requireAdminSignupApproval,
      requireEmailVerificationOnSignup: availability.requireEmailVerificationOnSignup,
      forgotPasswordEnabled: availability.enableForgotPassword,
      hasUsers: availability.userCount > 0
    };
  });

  fastify.post("/api/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const normalizedEmail = body.email.trim().toLowerCase();
    const passwordHash = await hashPassword(body.password);

    let registrationResult: RegisterResult | undefined;

    try {
      registrationResult = await withTransaction(async (client) => {
        await acquireRegistrationGuardLock(client);

        const availability = await getRegistrationAvailability(client);
        const isFirstUserSignup = availability.userCount === 0;

        if (!isFirstUserSignup && !availability.allowUserSignup) {
          return {
            blocked: true
          };
        }

        const requiresAdminApproval = !isFirstUserSignup && availability.requireAdminSignupApproval;
        const requiresEmailVerification = !isFirstUserSignup && availability.requireEmailVerificationOnSignup;
        const signupApprovalStatus = requiresAdminApproval ? "pending" : "approved";
        const emailVerifiedAt = requiresEmailVerification ? null : new Date().toISOString();
        const isActive = !requiresAdminApproval && !requiresEmailVerification;

        const existingEmailRes = await client.query<{ id: string }>(
          `SELECT id
             FROM users
            WHERE lower(email) = lower($1)
            LIMIT 1`,
          [normalizedEmail]
        );
        if ((existingEmailRes.rowCount ?? 0) > 0) {
          const duplicateError = new Error("Email already exists") as Error & { code?: string };
          duplicateError.code = "23505";
          throw duplicateError;
        }

        const userRes = await client.query<{ id: string; email: string; is_super_admin: boolean }>(
          `INSERT INTO users (email, password_hash, display_name, is_super_admin, is_active, signup_approval_status, email_verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, email, is_super_admin`,
          [normalizedEmail, passwordHash, body.displayName ?? null, isFirstUserSignup, isActive, signupApprovalStatus, emailVerifiedAt]
        );

        const user = userRes.rows[0];

        if (requiresEmailVerification) {
          return {
            blocked: false,
            pendingEmailVerification: true,
            pendingApproval: requiresAdminApproval,
            user
          };
        }

        if (requiresAdminApproval) {
          return {
            blocked: false,
            pendingEmailVerification: false,
            pendingApproval: true,
            user
          };
        }

        const workspaceName = body.workspaceName ?? `${body.displayName ?? "My"} Workspace`;
        const slugBase = workspaceName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "workspace";

        for (let attempt = 0; attempt < 10; attempt += 1) {
          const slug = `${slugBase}-${Math.floor(Math.random() * 100000)}`;

          try {
            const workspaceRes = await client.query<{ id: string; icon_key: string }>(
              `INSERT INTO workspaces (name, slug)
               VALUES ($1, $2)
               RETURNING id, icon_key`,
              [workspaceName, slug]
            );

            const workspaceId = workspaceRes.rows[0].id;

            await client.query(
              `INSERT INTO workspace_members (workspace_id, user_id, role)
               VALUES ($1, $2, 'owner')`,
              [workspaceId, user.id]
            );

            await client.query(
              `INSERT INTO workspace_settings (workspace_id, memory_enabled)
               VALUES ($1, $2)
               ON CONFLICT (workspace_id) DO NOTHING`,
              [workspaceId, DEFAULT_MEMORY_ENABLED]
            );

            return {
              blocked: false,
              pendingEmailVerification: false,
              pendingApproval: false,
              user,
              workspace: {
                id: workspaceId,
                name: workspaceName,
                iconKey: workspaceRes.rows[0].icon_key
              }
            };
          } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || (error as { code?: string }).code !== "23505") {
              throw error;
            }
          }
        }

        throw new Error("Unable to allocate workspace slug");
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
        return reply.status(409).send({ error: "Email already exists" });
      }
      throw error;
    }

    if (!registrationResult) {
      throw new Error("Registration failed");
    }

    if (registrationResult.blocked) {
      return reply.status(403).send({ error: "New user sign ups are currently disabled." });
    }

    if (registrationResult.pendingEmailVerification) {
      try {
        await assertSignupVerificationSendAllowed(registrationResult.user.email);
        const challenge = await createSignupVerificationChallenge({
          userId: registrationResult.user.id,
          email: registrationResult.user.email,
          requestedByIp: request.ip ?? null
        });
        await queueSignupVerificationEmail({
          userId: registrationResult.user.id,
          email: registrationResult.user.email,
          code: challenge.code,
          expiresMinutes: verificationCodeExpiryMinutes()
        });
      } catch (error) {
        fastify.log.error({ error }, "Failed to issue signup verification email");
      }

      return reply.status(202).send({
        pendingEmailVerification: true,
        pendingApproval: registrationResult.pendingApproval,
        message: registrationResult.pendingApproval
          ? "Signup created. Verify your email first, then wait for admin approval."
          : "Signup created. Enter the verification code sent to your email."
      });
    }

    if (registrationResult.pendingApproval) {
      return reply.status(202).send({
        pendingApproval: true,
        message: "Signup submitted. Your account is pending admin approval."
      });
    }

    if (registrationResult.workspace) {
      try {
        await createDefaultProjectForWorkspace({
          workspaceId: registrationResult.workspace.id,
          userId: registrationResult.user.id,
          displayName: body.displayName ?? null,
          workspaceName: registrationResult.workspace.name
        });
      } catch (error) {
        try {
          await query(`DELETE FROM workspaces WHERE id = $1`, [registrationResult.workspace.id]);
        } catch (cleanupError) {
          fastify.log.error({ cleanupError, workspaceId: registrationResult.workspace.id }, "Failed to roll back workspace after default project provisioning error");
        }

        throw error;
      }
    }

    const token = await signSessionToken(reply, {
      id: registrationResult.user.id,
      email: registrationResult.user.email
    });

    return reply.send({
      token,
      user: registrationResult.user,
      workspace: registrationResult.workspace
    });
  });

  fastify.post("/api/auth/signup/resend-code", async (request, reply) => {
    const body = resendSignupCodeSchema.parse(request.body);
    const normalizedEmail = body.email.trim().toLowerCase();

    const userRes = await query<{
      id: string;
      email: string;
      email_verified_at: string | null;
    }>(
      `SELECT id, email, email_verified_at::text
         FROM users
        WHERE lower(email) = lower($1)`,
      [normalizedEmail]
    );

    if ((userRes.rowCount ?? 0) === 0) {
      return {
        ok: true,
        message: "If an account exists, a new verification code will be sent shortly."
      };
    }

    const user = userRes.rows[0];
    if (user.email_verified_at) {
      return {
        ok: true,
        message: "This account is already verified."
      };
    }

    try {
      await assertSignupVerificationSendAllowed(user.email);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(429).send({ error: message });
    }
    const challenge = await createSignupVerificationChallenge({
      userId: user.id,
      email: user.email,
      requestedByIp: request.ip ?? null
    });
    await queueSignupVerificationEmail({
      userId: user.id,
      email: user.email,
      code: challenge.code,
      expiresMinutes: verificationCodeExpiryMinutes()
    });

    return {
      ok: true,
      message: "A new verification code has been sent."
    };
  });

  fastify.post("/api/auth/signup/verify-code", async (request, reply) => {
    const body = verifySignupCodeSchema.parse(request.body);
    let verification: { userId: string; email: string };
    try {
      verification = await verifySignupCode({
        email: body.email,
        code: body.code
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.toLowerCase().includes("too many") ? 429 : 400;
      return reply.status(status).send({ error: message });
    }

    const userRes = await query<{
      id: string;
      email: string;
      is_super_admin: boolean;
      signup_approval_status: "approved" | "pending" | "rejected";
      is_active: boolean;
    }>(
      `UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, now()),
              is_active = CASE
                WHEN signup_approval_status = 'approved' THEN true
                ELSE is_active
              END,
              updated_at = now()
        WHERE id = $1
    RETURNING id, email, is_super_admin, signup_approval_status, is_active`,
      [verification.userId]
    );

    if ((userRes.rowCount ?? 0) === 0) {
      throw new Error("User not found");
    }

    const user = userRes.rows[0];

    if (user.signup_approval_status === "pending") {
      return reply.status(202).send({
        pendingApproval: true,
        message: "Email verified. Your signup request is now pending admin approval."
      });
    }

    if (user.signup_approval_status === "rejected") {
      return reply.status(403).send({
        error: "Your signup request was rejected by an admin."
      });
    }

    await ensureUserHasWorkspace(user.id);

    const token = await signSessionToken(reply, {
      id: user.id,
      email: user.email
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        is_super_admin: user.is_super_admin
      }
    });
  });

  fastify.post("/api/auth/password/forgot", async (request) => {
    const body = forgotPasswordSchema.parse(request.body);
    const normalizedEmail = body.email.trim().toLowerCase();
    const availability = await getRegistrationAvailability();

    if (!availability.enableForgotPassword) {
      return {
        ok: true,
        message: "If the account exists, reset instructions will be sent."
      };
    }

    const userRes = await query<{ id: string; email: string }>(
      `SELECT id, email
         FROM users
        WHERE lower(email) = lower($1)`,
      [normalizedEmail]
    );

    if ((userRes.rowCount ?? 0) > 0) {
      const user = userRes.rows[0];
      try {
        await assertPasswordResetSendAllowed(user.email);
        const challenge = await createPasswordResetChallenge({
          userId: user.id,
          email: user.email,
          requestedByIp: request.ip ?? null
        });
        await queuePasswordResetEmail({
          userId: user.id,
          email: user.email,
          token: challenge.token,
          expiresMinutes: passwordResetExpiryMinutes()
        });
      } catch {
        // Keep forgot-password response opaque to avoid email enumeration.
      }
    }

    return {
      ok: true,
      message: "If the account exists, reset instructions will be sent."
    };
  });

  fastify.post("/api/auth/password/reset", async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    let tokenRecord: { userId: string; email: string };
    try {
      tokenRecord = await consumePasswordResetToken(body.token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
    const passwordHash = await hashPassword(body.password);

    const updateRes = await query(
      `UPDATE users
          SET password_hash = $2,
              session_valid_after = date_trunc('second', now()),
              updated_at = now()
        WHERE id = $1`,
      [tokenRecord.userId, passwordHash]
    );

    if ((updateRes.rowCount ?? 0) === 0) {
      throw new Error("User not found");
    }

    return {
      ok: true,
      message: "Password has been reset."
    };
  });

  fastify.post("/api/auth/newsletter/unsubscribe", async (request, reply) => {
    const body = unsubscribeSchema.parse(request.body);
    const token = verifySignedUserToken({
      token: body.token,
      purpose: "newsletter_unsubscribe"
    });

    if (!token) {
      return reply.status(400).send({ error: "Invalid or expired unsubscribe token." });
    }

    await query(
      `UPDATE users
          SET newsletter_subscribed = false,
              newsletter_unsubscribed_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [token.userId]
    );

    return {
      ok: true,
      message: "You have been unsubscribed from newsletters."
    };
  });

  fastify.post("/api/auth/login", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      }
    }
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const normalizedEmail = body.email.trim().toLowerCase();

    const userRes = await query<{
      id: string;
      email: string;
      password_hash: string;
      is_super_admin: boolean;
      is_active: boolean;
      signup_approval_status: "approved" | "pending" | "rejected";
      email_verified_at: string | null;
      theme_preference: ThemePreferenceValue;
    }>(
      `SELECT id, email, password_hash, is_super_admin, is_active, signup_approval_status, email_verified_at::text, theme_preference
         FROM users
        WHERE lower(email) = lower($1)`,
      [normalizedEmail]
    );

    if ((userRes.rowCount ?? 0) === 0) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const user = userRes.rows[0];

    // Verify password BEFORE checking account status to prevent account enumeration.
    // An attacker who doesn't know the password should never learn whether an email
    // has an account or what its status is.
    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    if (!user.is_active) {
      if (!user.email_verified_at) {
        return reply.status(403).send({ error: "Please verify your email before logging in." });
      }
      if (user.signup_approval_status === "pending") {
        return reply.status(403).send({ error: "Your account is pending admin approval." });
      }
      if (user.signup_approval_status === "rejected") {
        return reply.status(403).send({ error: "Your signup request was rejected by an admin." });
      }
      return reply.status(403).send({ error: "Your account has been deactivated." });
    }

    await ensureUserHasWorkspace(user.id);
    await query(`UPDATE users SET last_login_at = now(), last_seen_at = now() WHERE id = $1`, [user.id]);

    const token = await signSessionToken(reply, { id: user.id, email: user.email });

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        is_super_admin: user.is_super_admin,
        theme_preference: user.theme_preference
      }
    });
  });

  fastify.get("/api/auth/me", { preHandler: fastify.authenticate }, async (request) => {
    await ensureUserHasWorkspace(request.user.id);

    const userRes = await query<{
      id: string;
      email: string;
      display_name: string | null;
      is_super_admin: boolean;
      byo_enabled: boolean;
      byo_provider: string | null;
      byo_forced_model: string | null;
      onboarding_completed_at: string | null;
      theme_preference: ThemePreferenceValue;
      task_page_preferences_json: unknown;
    }>(
      `SELECT id,
              email,
              display_name,
              is_super_admin,
              byo_enabled,
              byo_provider,
              (SELECT forced_model
                 FROM user_chatgpt_auth
                WHERE user_id = users.id) AS byo_forced_model,
              onboarding_completed_at::text,
              theme_preference,
              task_page_preferences_json
         FROM users
        WHERE id = $1`,
      [request.user.id]
    );

    if ((userRes.rowCount ?? 0) === 0) {
      throw new Error("User not found");
    }

    const workspacesRes = await query<{ id: string; name: string; icon_key: string; role: string; member_count: number }>(
      `SELECT w.id,
              w.name,
              w.icon_key,
              wm.role,
              (SELECT COUNT(*)::int FROM workspace_members member_wm WHERE member_wm.workspace_id = w.id) AS member_count
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = $1
        ORDER BY w.created_at ASC`,
      [request.user.id]
    );

    const { task_page_preferences_json, ...user } = userRes.rows[0];

    return {
      user: {
        ...user,
        task_page_preferences: normalizeTaskPagePreferences(task_page_preferences_json)
      },
      workspaces: workspacesRes.rows.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        iconKey: workspace.icon_key,
        role: workspace.role,
        memberCount: workspace.member_count
      }))
    };
  });

  fastify.patch("/api/auth/preferences", { preHandler: fastify.authenticate }, async (request) => {
    const body = updatePreferencesSchema.parse(request.body);
    const updateRes = await withTransaction(async (client) => {
      const currentRes = await client.query<{
        theme_preference: ThemePreferenceValue;
        task_page_preferences_json: unknown;
      }>(
        `SELECT theme_preference, task_page_preferences_json
           FROM users
          WHERE id = $1
          FOR UPDATE`,
        [request.user.id]
      );

      if ((currentRes.rowCount ?? 0) === 0) {
        throw new Error("User not found");
      }

      const current = currentRes.rows[0];
      const nextThemePreference = body.themePreference ?? current.theme_preference;
      const nextTaskPagePreferences = body.taskPagePreferences
        ? mergeTaskPagePreferences(current.task_page_preferences_json, body.taskPagePreferences)
        : normalizeTaskPagePreferences(current.task_page_preferences_json);

      return client.query<{
        theme_preference: ThemePreferenceValue;
        task_page_preferences_json: unknown;
      }>(
        `UPDATE users
            SET theme_preference = $2,
                task_page_preferences_json = $3::jsonb,
                updated_at = CASE
                  WHEN theme_preference IS DISTINCT FROM $2
                    OR task_page_preferences_json IS DISTINCT FROM $3::jsonb
                  THEN now()
                  ELSE updated_at
                END
          WHERE id = $1
      RETURNING theme_preference, task_page_preferences_json`,
        [request.user.id, nextThemePreference, JSON.stringify(nextTaskPagePreferences)]
      );
    });

    if ((updateRes.rowCount ?? 0) === 0) {
      throw new Error("User not found");
    }

    return {
      themePreference: updateRes.rows[0].theme_preference,
      taskPagePreferences: normalizeTaskPagePreferences(updateRes.rows[0].task_page_preferences_json)
    };
  });

  fastify.post("/api/auth/onboarding/complete", { preHandler: fastify.authenticate }, async (request) => {
    const userRes = await query<{ onboarding_completed_at: string }>(
      `UPDATE users
          SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
              updated_at = CASE WHEN onboarding_completed_at IS NULL THEN now() ELSE updated_at END
        WHERE id = $1
    RETURNING onboarding_completed_at::text`,
      [request.user.id]
    );

    if ((userRes.rowCount ?? 0) === 0) {
      throw new Error("User not found");
    }

    return {
      onboardingCompletedAt: userRes.rows[0].onboarding_completed_at
    };
  });

  fastify.post("/api/auth/logout", { preHandler: fastify.authenticate }, async (request) => {
    await invalidateUserSessions(request.user.id);
    return { ok: true };
  });
};
