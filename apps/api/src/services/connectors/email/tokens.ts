import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../../../lib/config.js";

interface SignedTokenPayload {
  sub: string;
  purpose: string;
  exp: number;
}

function tokenSecret(): string {
  return `${config.security.jwtSecret}:email-token-v1`;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(serializedPayload: string): string {
  return createHmac("sha256", tokenSecret()).update(serializedPayload).digest("base64url");
}

export function hashEmailSecret(secret: string): string {
  return createHmac("sha256", tokenSecret()).update(secret).digest("hex");
}

export function secureCompareHash(inputSecret: string, expectedHashHex: string): boolean {
  const inputHash = Buffer.from(hashEmailSecret(inputSecret), "hex");
  const expectedHash = Buffer.from(expectedHashHex, "hex");
  if (inputHash.length !== expectedHash.length) {
    return false;
  }
  return timingSafeEqual(inputHash, expectedHash);
}

export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generatePasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createSignedUserToken(input: {
  userId: string;
  purpose: "newsletter_unsubscribe";
  expiresAtMs: number;
}): string {
  const payload: SignedTokenPayload = {
    sub: input.userId,
    purpose: input.purpose,
    exp: Math.floor(input.expiresAtMs / 1000)
  };
  const serializedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(serializedPayload);
  return `${serializedPayload}.${signature}`;
}

export function verifySignedUserToken(input: {
  token: string;
  purpose: "newsletter_unsubscribe";
}): { userId: string } | null {
  const [encodedPayload, providedSignature] = input.token.split(".");
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  let payload: SignedTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload)) as SignedTokenPayload;
  } catch {
    return null;
  }

  if (!payload || payload.purpose !== input.purpose || typeof payload.sub !== "string" || typeof payload.exp !== "number") {
    return null;
  }

  if (Date.now() >= payload.exp * 1000) {
    return null;
  }

  return {
    userId: payload.sub
  };
}
