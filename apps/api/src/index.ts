import fs from "node:fs";
import Fastify, { type FastifyError, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { warmStorageBackendsOnStartup } from "@meowbert/shared";
import { ZodError } from "zod";
import { config, secrets } from "./lib/config.js";
import { pool, query, queryWithRetry } from "./lib/db.js";
import { assertSchemaMigrationsTableExists, ensureDatabase, runMigrations } from "./lib/migrate.js";
import { closeQueue } from "./lib/queue.js";
import { redis } from "./lib/redis.js";
import { authRoutes } from "./routes/auth.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { workspaceFileRoutes } from "./routes/workspace-files.js";
import { projectRoutes } from "./routes/environments.js";
import { taskRoutes } from "./routes/tasks.js";
import { connectorRoutes } from "./routes/connectors/index.js";
import { desktopRoutes } from "./routes/desktop.js";
import { adminRoutes } from "./routes/admin.js";
import { adminSourceRoutes } from "./routes/admin-sources.js";
import { skillRoutes } from "./routes/skills.js";
import { subscriptionRoutes } from "./routes/subscription.js";
import { chatgptOauthRoutes } from "./routes/chatgpt-oauth-routes.js";
import { agentRoutes } from "./routes/agents.js";
import { sourceRoutes } from "./routes/sources.js";
import { announcementRoutes } from "./routes/announcements.js";
import { searchRoutes } from "./routes/search.js";
import { webPushRoutes } from "./routes/notifications/web-push-routes.js";
import { projectMasterInternalRoutes } from "./routes/project-master-internal-routes.js";
import { startTelegramPollingLoop } from "./services/connectors/telegram/telegram-polling.js";
import { startDiscordGatewayLoop } from "./services/connectors/discord/discord-gateway.js";
import { ensureListmonkTemplatesSynced } from "./services/connectors/email/template-sync.js";
import { storageBackendRegistry } from "./services/storage/backend-registry.js";
import { startApiSandboxCleanupLoop } from "./services/runtime/sandbox-cleanup.js";
import { apiSandboxManager } from "./services/runtime/sandbox.js";
import { startCanvasDevServerCleanupLoop } from "./services/canvases/canvas-dev-server.js";
import { startTaskSearchSyncLoop } from "./services/task-search/sync.js";
import { recordAuthenticatedUserSeen } from "./services/auth/user-activity.js";
import {
  assertSessionTokenAccepted,
  type SessionTokenPayload
} from "./services/auth/session-tokens.js";

const DEFAULT_DOCS_URL = "http://localhost:4173";

async function getRateLimitKey(request: FastifyRequest): Promise<string> {
  try {
    const payload = await request.jwtVerify<SessionTokenPayload>();
    if (typeof payload.id === "string" && payload.id.length > 0) {
      return `user:${payload.id}`;
    }
  } catch {
    // Invalid or absent auth still falls back to the client IP bucket.
  }

  return `ip:${request.ip}`;
}

function summarizeDbTarget(dbUrl: string):
  | {
      protocol: string;
      host: string;
      port: string;
      database: string;
      user: string;
      passwordLength: number;
    }
  | null {
  try {
    const parsed = new URL(dbUrl);
    return {
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\/+/, "") || "(none)",
      user: parsed.username ? decodeURIComponent(parsed.username) : "(none)",
      passwordLength: parsed.password ? decodeURIComponent(parsed.password).length : 0
    };
  } catch {
    return null;
  }
}

type DbAutoCreateSetting = {
  enabled: boolean;
  source: string;
};

type DbRequireSchemaSetting = {
  enabled: boolean;
  source: string;
};

function resolveDbAutoCreateSetting(): DbAutoCreateSetting {
  // Config JSON is the source of truth when provided.
  if (typeof config.db.autoCreateOnStartup === "boolean") {
    return {
      enabled: config.db.autoCreateOnStartup,
      source: "config.db.autoCreateOnStartup"
    };
  }

  const envOverride = process.env.MEOWBERT_DB_AUTO_CREATE?.trim().toLowerCase();
  if (envOverride === "true") {
    return { enabled: true, source: "MEOWBERT_DB_AUTO_CREATE=true" };
  }
  if (envOverride === "false") {
    return { enabled: false, source: "MEOWBERT_DB_AUTO_CREATE=false" };
  }
  if (envOverride === "1") {
    return { enabled: true, source: "MEOWBERT_DB_AUTO_CREATE=1" };
  }
  if (envOverride === "0") {
    return { enabled: false, source: "MEOWBERT_DB_AUTO_CREATE=0" };
  }

  // Safe default: never create production databases implicitly unless explicitly configured.
  return { enabled: false, source: "safe-default(false)" };
}

function resolveDbRequireSchemaSetting(): DbRequireSchemaSetting {
  // Config JSON is the source of truth when provided.
  if (typeof config.db.requireExistingSchemaOnStartup === "boolean") {
    return {
      enabled: config.db.requireExistingSchemaOnStartup,
      source: "config.db.requireExistingSchemaOnStartup"
    };
  }

  const envOverride = process.env.MEOWBERT_DB_REQUIRE_EXISTING_SCHEMA?.trim().toLowerCase();
  if (envOverride === "true") {
    return { enabled: true, source: "MEOWBERT_DB_REQUIRE_EXISTING_SCHEMA=true" };
  }
  if (envOverride === "false") {
    return { enabled: false, source: "MEOWBERT_DB_REQUIRE_EXISTING_SCHEMA=false" };
  }
  if (envOverride === "1") {
    return { enabled: true, source: "MEOWBERT_DB_REQUIRE_EXISTING_SCHEMA=1" };
  }
  if (envOverride === "0") {
    return { enabled: false, source: "MEOWBERT_DB_REQUIRE_EXISTING_SCHEMA=0" };
  }

  return { enabled: false, source: "safe-default(false)" };
}

function resolvePostgresDataPathSetting():
  | {
      value: string;
      source: string;
    }
  | null {
  const envValue = process.env.MEOWBERT_POSTGRES_DATA_PATH?.trim();
  if (envValue) {
    return {
      value: envValue,
      source: "MEOWBERT_POSTGRES_DATA_PATH"
    };
  }

  const configValue = config.deployment?.meowbertPostgresDataPath?.trim();
  if (configValue) {
    return {
      value: configValue,
      source: "config.deployment.meowbertPostgresDataPath"
    };
  }

  return null;
}

async function logStartupIntegrity(): Promise<void> {
  try {
    const [migrations, users, workspaces, fingerprint, dbAge] = await Promise.all([
      queryWithRetry<{ count: string }>("SELECT COUNT(*) AS count FROM schema_migrations"),
      queryWithRetry<{ count: string }>("SELECT COUNT(*) AS count FROM users"),
      queryWithRetry<{ count: string }>("SELECT COUNT(*) AS count FROM workspaces"),
      queryWithRetry<{ fingerprint: string; created_at: string }>(
        "SELECT fingerprint, created_at::text FROM database_fingerprint WHERE id = 1"
      ),
      queryWithRetry<{ age: string }>(
        "SELECT (now() - pg_catalog.pg_postmaster_start_time())::text AS age"
      ),
    ]);

    const migrationCount = parseInt(migrations.rows[0]?.count ?? "0", 10);
    const userCount = parseInt(users.rows[0]?.count ?? "0", 10);
    const workspaceCount = parseInt(workspaces.rows[0]?.count ?? "0", 10);
    const fp = fingerprint.rows[0]?.fingerprint ?? "(unknown)";
    const fpCreated = fingerprint.rows[0]?.created_at ?? "(unknown)";
    const postgresAge = dbAge.rows[0]?.age ?? "(unknown)";

    console.info("[startup] Database integrity check", {
      migrations: migrationCount,
      users: userCount,
      workspaces: workspaceCount,
      fingerprint: fp,
      fingerprintCreated: fpCreated,
      postgresUptime: postgresAge,
    });

    if (migrationCount > 1 && userCount === 0 && workspaceCount === 0) {
      console.error(
        "╔══════════════════════════════════════════════════════════════════╗\n" +
        "║  ⚠️  CRITICAL: DATABASE APPEARS TO HAVE BEEN WIPED              ║\n" +
        "║  Migrations exist but core tables are empty.                    ║\n" +
        "║  This usually means the Postgres data volume was replaced.      ║\n" +
        "║  Fingerprint: " + fp.padEnd(49, " ") + "║\n" +
        "╚══════════════════════════════════════════════════════════════════╝"
      );
    }
  } catch (error) {
    console.warn("[startup] Could not run integrity check (non-fatal):", (error as Error).message);
  }
}

function resolveDocsUrl(): string {
  const configured = config.web?.docsUrl?.trim();
  if (configured) {
    return configured;
  }

  return DEFAULT_DOCS_URL;
}

function buildDocsTargetUrl(pathQuery: string): string {
  const target = new URL(resolveDocsUrl());
  const normalizedPath = pathQuery.trim().length > 0 ? pathQuery.trim() : "/";
  const parsedPath = new URL(
    normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`,
    "http://localhost"
  );
  const basePath = target.pathname.endsWith("/")
    ? target.pathname.slice(0, -1)
    : target.pathname;
  target.pathname = `${basePath}${parsedPath.pathname}`.replace(/\/{2,}/g, "/");
  target.search = parsedPath.search;
  target.hash = parsedPath.hash;
  return target.toString();
}

function parseJsonWithRawBody(
  request: { rawBody?: string },
  body: string | Buffer,
  done: (error: Error | null, parsed?: unknown) => void
): void {
  const rawBody = typeof body === "string" ? body : body.toString("utf8");
  request.rawBody = rawBody;
  if (rawBody.trim().length === 0) {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(rawBody));
  } catch (error) {
    done(error instanceof Error ? error : new Error("Invalid JSON payload"));
  }
}

async function registerCoreServerPlugins(app: Fastify.FastifyInstance): Promise<void> {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    parseJsonWithRawBody(request as { rawBody?: string }, body, done);
  });
  app.addContentTypeParser("application/*+json", { parseAs: "string" }, (request, body, done) => {
    parseJsonWithRawBody(request as { rawBody?: string }, body, done);
  });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart);
  await app.register(jwt, { secret: secrets.jwtSecret });
  await app.register(websocket);
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    keyGenerator: getRateLimitKey
  });
  app.decorate("authenticate", async (request, reply) => {
    try {
      const queryToken = typeof (request.query as Record<string, unknown> | undefined)?.token === "string"
        ? (request.query as Record<string, unknown>).token as string
        : typeof (request.query as Record<string, unknown> | undefined)?.auth_token === "string"
        ? (request.query as Record<string, unknown>).auth_token as string
        : null;
      let tokenPayload: SessionTokenPayload;
      if (queryToken) {
        tokenPayload = app.jwt.verify<SessionTokenPayload>(queryToken);
      } else {
        tokenPayload = await request.jwtVerify<SessionTokenPayload>();
      }
      await assertSessionTokenAccepted({
        userId: tokenPayload.id,
        issuedAtSeconds: tokenPayload.iat
      });
      request.user = tokenPayload;
      if (typeof tokenPayload.id === "string" && tokenPayload.id.length > 0) {
        void recordAuthenticatedUserSeen(tokenPayload.id).catch((error) => {
          console.warn("[auth] Failed to update user last_seen_at", error);
        });
      }
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });
}

function registerServerErrorHandler(app: Fastify.FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: "Invalid request", issues: error.issues });
    }
    const exposed = error as Error & { statusCode?: number; exposeMessage?: boolean };
    if (
      exposed.exposeMessage === true
      && typeof exposed.statusCode === "number"
      && exposed.statusCode >= 400
      && exposed.statusCode < 600
    ) {
      return reply.status(exposed.statusCode).send({
        error: error instanceof Error ? error.message : "Request failed",
        ...(typeof (exposed as { stage?: unknown }).stage === "string"
          ? { stage: (exposed as unknown as { stage: string }).stage }
          : {})
      });
    }
    if (error instanceof Error && error.message.toLowerCase().includes("access denied")) {
      return reply.status(403).send({ error: error.message });
    }
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
      return reply.status(404).send({ error: error.message });
    }
    const fastifyStatus = (error as FastifyError).statusCode;
    if (typeof fastifyStatus === "number" && fastifyStatus >= 400 && fastifyStatus < 500) {
      return reply.status(fastifyStatus).send({
        error: error instanceof Error ? error.message : "Bad request"
      });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });
}

function registerPublicServerRoutes(app: Fastify.FastifyInstance): void {
  app.get("/health", async (_request, reply) => {
    try {
      await query("SELECT 1");
      return {
        ok: true,
        pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
      };
    } catch (error) {
      app.log.error(error, "Health check failed");
      return reply.status(503).send({
        ok: false,
        pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
      });
    }
  });
  app.get("/api/public/config", async () => ({
    docsUrl: resolveDocsUrl(),
    publicUrl: config.server.publicUrl,
    appUrl: config.web?.appUrl ?? null
  }));
  app.get("/api/public/docs", async (request, reply) => {
    const pathQuery =
      typeof (request.query as Record<string, unknown> | undefined)?.path === "string"
        ? ((request.query as Record<string, unknown>).path as string)
        : "/";
    return reply.redirect(buildDocsTargetUrl(pathQuery));
  });
}

async function registerApplicationRoutes(app: Fastify.FastifyInstance): Promise<void> {
  await app.register(authRoutes);
  await app.register(workspaceRoutes);
  await app.register(workspaceFileRoutes);
  await app.register(projectRoutes);
  await app.register(taskRoutes);
  await app.register(connectorRoutes);
  await app.register(desktopRoutes);
  await app.register(adminRoutes);
  await app.register(adminSourceRoutes);
  await app.register(subscriptionRoutes);
  await app.register(chatgptOauthRoutes);
  await app.register(skillRoutes);
  await app.register(agentRoutes);
  await app.register(sourceRoutes);
  await app.register(announcementRoutes);
  await app.register(searchRoutes);
  await app.register(webPushRoutes);
  await app.register(projectMasterInternalRoutes);
}

async function buildServer() {
  const app = Fastify({ logger: true, trustProxy: true });
  const stopTelegramPolling = startTelegramPollingLoop(app.log);
  const stopDiscordGateway = startDiscordGatewayLoop(app.log);
  const sandboxCleanupLoop = startApiSandboxCleanupLoop();
  const canvasDevServerCleanupLoop = startCanvasDevServerCleanupLoop();
  const taskSearchSyncLoop = startTaskSearchSyncLoop(app.log);

  await registerCoreServerPlugins(app);
  registerServerErrorHandler(app);
  registerPublicServerRoutes(app);
  await registerApplicationRoutes(app);
  app.addHook("onClose", async () => {
    stopTelegramPolling();
    stopDiscordGateway();
    await sandboxCleanupLoop.stop();
    canvasDevServerCleanupLoop.stop();
    taskSearchSyncLoop.stop();
    await closeQueue();
    await redis.quit();
    await pool.end();
  });
  return app;
}

async function start(): Promise<void> {
  const dbTarget = summarizeDbTarget(config.db.url);
  const dbAutoCreate = resolveDbAutoCreateSetting();
  const dbRequireSchema = resolveDbRequireSchemaSetting();
  const postgresDataPath = resolvePostgresDataPathSetting();
  const configDataPath = config.deployment?.meowbertPostgresDataPath?.trim();
  const envDataPath = process.env.MEOWBERT_POSTGRES_DATA_PATH?.trim();
  if (dbTarget) {
    console.info("[startup] Effective DB target", {
      ...dbTarget,
      autoCreateOnStartup: dbAutoCreate.enabled,
      autoCreateSource: dbAutoCreate.source,
      requireExistingSchemaOnStartup: dbRequireSchema.enabled,
      requireExistingSchemaSource: dbRequireSchema.source,
      postgresDataPath: postgresDataPath?.value ?? "(unset)",
      postgresDataPathSource: postgresDataPath?.source ?? "(unset)"
    });
  } else {
    console.info("[startup] Effective DB target", {
      parseError: true,
      rawUrlPreview: config.db.url.slice(0, 32),
      autoCreateOnStartup: dbAutoCreate.enabled,
      autoCreateSource: dbAutoCreate.source,
      requireExistingSchemaOnStartup: dbRequireSchema.enabled,
      requireExistingSchemaSource: dbRequireSchema.source,
      postgresDataPath: postgresDataPath?.value ?? "(unset)",
      postgresDataPathSource: postgresDataPath?.source ?? "(unset)"
    });
  }

  if (configDataPath && envDataPath && configDataPath !== envDataPath) {
    console.warn(
      `[startup] MEOWBERT_POSTGRES_DATA_PATH mismatch: config="${configDataPath}" env="${envDataPath}". ` +
        "Docker volume source follows env/compose value."
    );
  }

  fs.mkdirSync(config.runtime.environmentsRoot, { recursive: true });
  await apiSandboxManager.assertImageAvailable();

  await ensureDatabase(config.db.url, {
    allowCreate: dbAutoCreate.enabled
  });
  if (dbRequireSchema.enabled) {
    await assertSchemaMigrationsTableExists(pool);
  }
  await runMigrations(pool);
  await logStartupIntegrity();

  if (config.email.enabled) {
    try {
      const synced = await ensureListmonkTemplatesSynced();
      if (synced) {
        console.info("[startup] Email templates synced with Listmonk");
      } else {
        console.info("[startup] Listmonk provider not configured yet. Skipping email template sync.");
      }
    } catch (error) {
      console.error("[startup] Failed to sync Listmonk templates:", error);
    }
  }

  const app = await buildServer();
  await warmStorageBackendsOnStartup(storageBackendRegistry, {
    logger: {
      info: (message: string) => console.info(message),
      warn: (message: string) => console.warn(message),
      error: (message: string) => console.error(message)
    }
  });
  await app.listen({ host: config.server.host, port: config.server.port });
  app.log.info(`API listening on ${config.server.host}:${config.server.port}`);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
