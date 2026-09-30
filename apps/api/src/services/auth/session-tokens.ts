import type { FastifyReply } from "fastify";
import { query } from "../../lib/db.js";

export const SESSION_TOKEN_TTL = "7d";

export interface SessionTokenPayload {
  id: string;
  email: string;
  iat?: number;
  exp?: number;
}

export async function signSessionToken(
  reply: FastifyReply,
  payload: Pick<SessionTokenPayload, "id" | "email">
): Promise<string> {
  return reply.jwtSign(payload, { expiresIn: SESSION_TOKEN_TTL });
}

export async function assertSessionTokenAccepted(input: {
  userId: string;
  issuedAtSeconds?: number;
}): Promise<void> {
  const issuedAtSeconds = input.issuedAtSeconds;
  if (typeof issuedAtSeconds !== "number" || !Number.isFinite(issuedAtSeconds)) {
    throw new Error("Session token is missing an issued-at timestamp");
  }

  const userRes = await query<{
    is_active: boolean;
    signup_approval_status: "approved" | "pending" | "rejected";
    email_verified_at: Date | null;
    session_valid_after_seconds: string;
  }>(
    `SELECT is_active,
            signup_approval_status,
            email_verified_at,
            EXTRACT(EPOCH FROM session_valid_after)::bigint::text AS session_valid_after_seconds
       FROM users
      WHERE id = $1`,
    [input.userId]
  );

  if ((userRes.rowCount ?? 0) === 0) {
    throw new Error("Session user not found");
  }

  const user = userRes.rows[0];
  if (!user.is_active || user.signup_approval_status !== "approved" || user.email_verified_at === null) {
    throw new Error("Session user is not active");
  }

  const validAfterSeconds = Number.parseInt(user.session_valid_after_seconds, 10);
  if (Number.isFinite(validAfterSeconds) && issuedAtSeconds < validAfterSeconds) {
    throw new Error("Session token has been revoked");
  }
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await query(
    `UPDATE users
        SET session_valid_after = date_trunc('second', now()),
            updated_at = now()
      WHERE id = $1`,
    [userId]
  );
}
