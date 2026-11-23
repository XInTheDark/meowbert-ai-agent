import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdminAntigravityCredential, AntigravityLoginStartResult } from "@meowbert/shared";
import { saveAdminAntigravityCredential } from "./antigravity-credentials.js";

const LOGIN_SESSION_TTL_MS = 5 * 60 * 1000;
const AUTH_URL_TIMEOUT_MS = 20_000;
const COMPLETE_TIMEOUT_MS = 45_000;
const OAUTH_URL_PATTERN = /https:\/\/accounts\.google\.com\/[^\s"'<>]+|https:\/\/[^\s"'<>]*oauth[^\s"'<>]*/i;
const LOGGED_IN_EMAIL_PATTERN = /Logged in as\s+([^\s,;]+)/i;

export class AntigravityLoginError extends Error {
  readonly statusCode: number;
  readonly exposeMessage = true;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

interface PendingLoginSession {
  id: string;
  ownerUserId: string;
  label: string;
  tempHome: string;
  child: ChildProcessWithoutNullStreams;
  stdoutBuffer: string;
  stderrBuffer: string;
  exited: boolean;
  exitCode: number | null;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

const pendingSessions = new Map<string, PendingLoginSession>();

function resolveAgyBinary(): string {
  return process.env.MEOWBERT_AGY_BIN?.trim() || "agy";
}

async function cleanupSession(session: PendingLoginSession): Promise<void> {
  clearTimeout(session.timer);
  pendingSessions.delete(session.id);
  if (!session.exited) {
    try {
      session.child.kill("SIGTERM");
    } catch {
      // Ignore already-exited child.
    }
  }
  await fs.rm(session.tempHome, { recursive: true, force: true }).catch(() => undefined);
}

function waitForAuthUrl(session: PendingLoginSession): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const check = () => {
      const match = OAUTH_URL_PATTERN.exec(session.stdoutBuffer) ?? OAUTH_URL_PATTERN.exec(session.stderrBuffer);
      if (match) {
        cleanupListeners();
        resolve(match[0]);
      }
    };
    const onData = () => check();
    const onError = (error: Error) => {
      cleanupListeners();
      reject(new AntigravityLoginError(`Failed to start Antigravity CLI (${resolveAgyBinary()}): ${error.message}`, 500));
    };
    const onClose = (code: number | null) => {
      cleanupListeners();
      reject(new AntigravityLoginError(`Antigravity login exited before producing an authorization URL (code ${code ?? "unknown"}).`, 500));
    };
    const timer = setTimeout(() => {
      cleanupListeners();
      reject(new AntigravityLoginError("Timed out waiting for Antigravity login URL.", 504));
    }, AUTH_URL_TIMEOUT_MS);

    const cleanupListeners = () => {
      clearTimeout(timer);
      session.child.stdout.off("data", onData);
      session.child.stderr.off("data", onData);
      session.child.off("error", onError);
      session.child.off("close", onClose);
    };

    session.child.stdout.on("data", onData);
    session.child.stderr.on("data", onData);
    session.child.once("error", onError);
    session.child.once("close", onClose);
    check();
  });
}

function waitForLoginExit(session: PendingLoginSession): Promise<number | null> {
  if (session.exited) return Promise.resolve(session.exitCode);
  return new Promise<number | null>((resolve, reject) => {
    const onClose = (code: number | null) => {
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      session.child.off("close", onClose);
      reject(new AntigravityLoginError("Timed out waiting for Antigravity to exchange the authorization code.", 504));
    }, COMPLETE_TIMEOUT_MS);
    session.child.once("close", onClose);
  });
}

export async function startAntigravityLogin(ownerUserId: string, label?: string): Promise<AntigravityLoginStartResult> {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-agy-login-"));
  await fs.chmod(tempHome, 0o700);
  const child = spawn(resolveAgyBinary(), ["acp", "--login"], {
    cwd: tempHome,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: tempHome,
      AGY_CLI_DISABLE_AUTO_UPDATE: "true"
    }
  });

  const id = randomUUID();
  const expiresAt = Date.now() + LOGIN_SESSION_TTL_MS;
  const session: PendingLoginSession = {
    id,
    ownerUserId,
    label: (label ?? "").trim(),
    tempHome,
    child,
    stdoutBuffer: "",
    stderrBuffer: "",
    exited: false,
    exitCode: null,
    expiresAt,
    timer: setTimeout(() => { void cleanupSession(session); }, LOGIN_SESSION_TTL_MS)
  };
  session.timer.unref();
  child.stdout.on("data", (chunk: Buffer) => { session.stdoutBuffer += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { session.stderrBuffer += chunk.toString("utf8"); });
  child.once("close", (code) => {
    session.exited = true;
    session.exitCode = code;
  });
  pendingSessions.set(id, session);

  try {
    const authUrl = await waitForAuthUrl(session);
    return { loginSessionId: id, authUrl, expiresAt: new Date(expiresAt).toISOString() };
  } catch (error) {
    await cleanupSession(session);
    throw error;
  }
}

export async function completeAntigravityLogin(
  ownerUserId: string,
  loginSessionId: string,
  codeOrCallbackUrl: string
): Promise<AdminAntigravityCredential[]> {
  const session = pendingSessions.get(loginSessionId);
  if (!session || session.ownerUserId !== ownerUserId) {
    throw new AntigravityLoginError("Antigravity login session not found or expired.", 404);
  }
  if (session.exited) {
    await cleanupSession(session);
    throw new AntigravityLoginError("Antigravity login process already exited. Start a new sign-in.", 409);
  }

  try {
    session.child.stdin.write(`${codeOrCallbackUrl.trim()}\n`);
    session.child.stdin.end();
    const exitCode = await waitForLoginExit(session);
    if (exitCode !== 0) {
      throw new AntigravityLoginError("Antigravity rejected the authorization code. Verify the code and try again.", 400);
    }

    const tokenPath = path.join(session.tempHome, ".gemini", "antigravity-cli", "antigravity-oauth-token");
    const authStatePath = path.join(session.tempHome, ".gemini", "antigravity-cli", "cache", "acp-auth-state.json");
    const [oauthTokenJson, acpAuthStateJson] = await Promise.all([
      fs.readFile(tokenPath, "utf8"),
      fs.readFile(authStatePath, "utf8").catch(() => JSON.stringify({ methodId: "oauth-personal" }))
    ]);
    const emailMatch = LOGGED_IN_EMAIL_PATTERN.exec(`${session.stdoutBuffer}\n${session.stderrBuffer}`);
    const email = emailMatch ? emailMatch[1].replace(/[.,]+$/, "") : null;

    return await saveAdminAntigravityCredential({
      label: session.label || email || "Google Account",
      email,
      oauthTokenJson,
      acpAuthStateJson
    });
  } finally {
    await cleanupSession(session);
  }
}

export async function cancelAntigravityLogin(ownerUserId: string, loginSessionId: string): Promise<void> {
  const session = pendingSessions.get(loginSessionId);
  if (!session || session.ownerUserId !== ownerUserId) return;
  await cleanupSession(session);
}
