import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const CIPHER_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_SALT = Buffer.from("meowbert:antigravity-credentials:v1", "utf8");
const KEY_INFO = Buffer.from("aes-256-gcm-key", "utf8");

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), KEY_SALT, KEY_INFO, 32));
}

export function encryptAntigravitySecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${CIPHER_VERSION}:${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptAntigravitySecret(payload: string, secret: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
    throw new Error("Unsupported Antigravity credential ciphertext format.");
  }
  const key = deriveKey(secret);
  const iv = Buffer.from(parts[1], "base64url");
  const authTag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function parseAntigravityTokenExpiry(rawTokenJson: string): string | null {
  try {
    const parsed = JSON.parse(rawTokenJson) as { token?: { expiry?: unknown } };
    const expiry = parsed?.token?.expiry;
    if (typeof expiry !== "string" || !expiry.trim()) return null;
    const ms = Date.parse(expiry);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  } catch {
    return null;
  }
}
