import type { PoolClient } from "pg";
import { config } from "../../../lib/config.js";
import { query, withTransaction } from "../../../lib/db.js";
import { generatePasswordResetToken, generateVerificationCode, hashEmailSecret, secureCompareHash } from "./tokens.js";

const SIGNUP_VERIFICATION_EXPIRY_MINUTES = 10;
const PASSWORD_RESET_EXPIRY_MINUTES = 30;

type ChallengeType = "signup_verification" | "password_reset";

interface ChallengeRow {
  id: string;
  user_id: string;
  email: string;
  secret_hash: string;
  expires_at: string;
  failed_attempts: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function addMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

async function getChallengeHourlyCount(email: string, challengeType: ChallengeType): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM auth_email_challenges
      WHERE email = $1
        AND challenge_type = $2
        AND created_at >= now() - interval '1 hour'`,
    [normalizeEmail(email), challengeType]
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function getLatestChallengeTimestamp(email: string, challengeType: ChallengeType): Promise<Date | null> {
  const result = await query<{ created_at: string | null }>(
    `SELECT created_at::text
       FROM auth_email_challenges
      WHERE email = $1
        AND challenge_type = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalizeEmail(email), challengeType]
  );

  const createdAt = result.rows[0]?.created_at;
  return createdAt ? new Date(createdAt) : null;
}

export async function assertSignupVerificationSendAllowed(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  const hourlyCount = await getChallengeHourlyCount(normalizedEmail, "signup_verification");
  if (hourlyCount >= config.email.rateLimits.signupVerificationPerHour) {
    throw new Error("Too many verification emails sent. Please try again later.");
  }

  const latest = await getLatestChallengeTimestamp(normalizedEmail, "signup_verification");
  if (!latest) {
    return;
  }

  const elapsedMs = Date.now() - latest.getTime();
  if (elapsedMs < config.email.rateLimits.signupResendCooldownSeconds * 1000) {
    throw new Error("Please wait before requesting another verification code.");
  }
}

export async function assertPasswordResetSendAllowed(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  const hourlyCount = await getChallengeHourlyCount(normalizedEmail, "password_reset");
  if (hourlyCount >= config.email.rateLimits.forgotPasswordPerHour) {
    throw new Error("Too many password reset emails sent. Please try again later.");
  }
}

async function consumePreviousOpenChallenges(client: PoolClient, email: string, challengeType: ChallengeType): Promise<void> {
  await client.query(
    `UPDATE auth_email_challenges
        SET consumed_at = now()
      WHERE email = $1
        AND challenge_type = $2
        AND consumed_at IS NULL`,
    [normalizeEmail(email), challengeType]
  );
}

export async function createSignupVerificationChallenge(input: {
  userId: string;
  email: string;
  requestedByIp: string | null;
}): Promise<{ code: string; expiresAt: Date }> {
  const normalizedEmail = normalizeEmail(input.email);
  const code = generateVerificationCode();
  const expiresAt = addMinutes(SIGNUP_VERIFICATION_EXPIRY_MINUTES);

  await withTransaction(async (client) => {
    await consumePreviousOpenChallenges(client, normalizedEmail, "signup_verification");
    await client.query(
      `INSERT INTO auth_email_challenges (
         user_id,
         email,
         challenge_type,
         secret_hash,
         expires_at,
         requested_by_ip
       )
       VALUES ($1, $2, 'signup_verification', $3, $4, $5)`,
      [input.userId, normalizedEmail, hashEmailSecret(code), expiresAt.toISOString(), input.requestedByIp]
    );
  });

  return { code, expiresAt };
}

export async function createPasswordResetChallenge(input: {
  userId: string;
  email: string;
  requestedByIp: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const normalizedEmail = normalizeEmail(input.email);
  const token = generatePasswordResetToken();
  const expiresAt = addMinutes(PASSWORD_RESET_EXPIRY_MINUTES);

  await withTransaction(async (client) => {
    await consumePreviousOpenChallenges(client, normalizedEmail, "password_reset");
    await client.query(
      `INSERT INTO auth_email_challenges (
         user_id,
         email,
         challenge_type,
         secret_hash,
         expires_at,
         requested_by_ip
       )
       VALUES ($1, $2, 'password_reset', $3, $4, $5)`,
      [input.userId, normalizedEmail, hashEmailSecret(token), expiresAt.toISOString(), input.requestedByIp]
    );
  });

  return { token, expiresAt };
}

function isExpired(expiresAt: string): boolean {
  return Date.now() >= new Date(expiresAt).getTime();
}

export async function verifySignupCode(input: {
  email: string;
  code: string;
}): Promise<{ userId: string; email: string }> {
  const normalizedEmail = normalizeEmail(input.email);

  return withTransaction(async (client) => {
    const rateLimitResult = await client.query<{ total_failed_attempts: number }>(
      `SELECT COALESCE(SUM(failed_attempts), 0)::int AS total_failed_attempts
         FROM auth_email_challenges
        WHERE email = $1
          AND challenge_type = 'signup_verification'
          AND created_at >= now() - interval '1 hour'`,
      [normalizedEmail]
    );
    const failedAttempts = Number(rateLimitResult.rows[0]?.total_failed_attempts ?? 0);
    if (failedAttempts >= config.email.rateLimits.verificationAttemptsPerHour) {
      throw new Error("Too many verification attempts. Please request a new code.");
    }

    const challengeResult = await client.query<ChallengeRow>(
      `SELECT id, user_id, email, secret_hash, expires_at::text, failed_attempts
         FROM auth_email_challenges
        WHERE email = $1
          AND challenge_type = 'signup_verification'
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [normalizedEmail]
    );

    if ((challengeResult.rowCount ?? 0) === 0) {
      throw new Error("Verification code is invalid or expired.");
    }

    const challenge = challengeResult.rows[0];
    if (isExpired(challenge.expires_at)) {
      throw new Error("Verification code has expired. Please request a new one.");
    }

    if (!secureCompareHash(input.code.trim(), challenge.secret_hash)) {
      await client.query(
        `UPDATE auth_email_challenges
            SET failed_attempts = failed_attempts + 1
          WHERE id = $1`,
        [challenge.id]
      );
      throw new Error("Invalid verification code.");
    }

    await client.query(
      `UPDATE auth_email_challenges
          SET consumed_at = now()
        WHERE id = $1`,
      [challenge.id]
    );

    return {
      userId: challenge.user_id,
      email: challenge.email
    };
  });
}

export async function consumePasswordResetToken(token: string): Promise<{ userId: string; email: string }> {
  const tokenHash = hashEmailSecret(token.trim());

  return withTransaction(async (client) => {
    const challengeResult = await client.query<ChallengeRow>(
      `SELECT id, user_id, email, secret_hash, expires_at::text, failed_attempts
         FROM auth_email_challenges
        WHERE challenge_type = 'password_reset'
          AND secret_hash = $1
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [tokenHash]
    );

    const challenge = challengeResult.rows[0];
    if (!challenge) {
      throw new Error("Reset token is invalid or already used.");
    }

    if (isExpired(challenge.expires_at)) {
      throw new Error("Reset token has expired.");
    }

    await client.query(
      `UPDATE auth_email_challenges
          SET consumed_at = now()
        WHERE id = $1`,
      [challenge.id]
    );

    return {
      userId: challenge.user_id,
      email: challenge.email
    };
  });
}

export function verificationCodeExpiryMinutes(): number {
  return SIGNUP_VERIFICATION_EXPIRY_MINUTES;
}

export function passwordResetExpiryMinutes(): number {
  return PASSWORD_RESET_EXPIRY_MINUTES;
}
