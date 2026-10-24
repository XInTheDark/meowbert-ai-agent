import { createHmac, timingSafeEqual } from "node:crypto";

// A run lease token names one run and one lease epoch. The epoch is checked against the current
// lease on every call, so a token outlives its lease only as a token that is always refused.
export interface RunLeaseClaims {
  kind: "run_lease";
  runId: string;
  taskId: string;
  epoch: number;
  holder: string;
  iat: number;
  exp: number;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(unsigned: string, secret: string): string {
  return createHmac("sha256", secret).update(unsigned).digest("base64url");
}

export function signRunLeaseToken(
  claims: Pick<RunLeaseClaims, "runId" | "taskId" | "epoch" | "holder">,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ kind: "run_lease", ...claims, iat: now, exp: now + ttlSeconds }));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned, secret)}`;
}

export class RunLeaseTokenError extends Error {
  constructor(message = "Invalid run lease token.") {
    super(message);
    this.name = "RunLeaseTokenError";
  }
}

function isClaims(value: unknown): value is RunLeaseClaims {
  const claims = value as Partial<RunLeaseClaims> | null;
  return claims?.kind === "run_lease"
    && typeof claims.runId === "string"
    && typeof claims.taskId === "string"
    && typeof claims.epoch === "number"
    && typeof claims.holder === "string"
    && typeof claims.exp === "number";
}

export function verifyRunLeaseToken(token: string, secret: string): RunLeaseClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new RunLeaseTokenError();
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new RunLeaseTokenError();
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new RunLeaseTokenError();
  }
  if (!isClaims(claims)) throw new RunLeaseTokenError();
  if (claims.exp <= Math.floor(Date.now() / 1000)) throw new RunLeaseTokenError("Run lease token expired.");
  return claims;
}
