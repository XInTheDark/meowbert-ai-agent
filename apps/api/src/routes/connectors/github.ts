import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { query } from "../../lib/db.js";
import {
  buildWorkspaceGitHubInstallRedirectUrl,
  DESKTOP_GITHUB_RETURN_ORIGIN,
  fetchGitHubInstallationDetails,
  generateGitHubInstallState,
  getGitHubCentralWebhookUrl,
  getGitHubInstallCallbackUrl,
  GITHUB_INSTALL_STATE_TTL_MINUTES,
  isGitHubConnectorEnabled,
  normalizeInstallReturnOrigin,
  verifyGitHubWebhookSignature
} from "../../services/connectors/github/app-auth.js";
import {
  connectWorkspaceGitHubExistingInstallation,
  consumeWorkspaceGitHubInstallState,
  createWorkspaceGitHubInstallState,
  deleteWorkspaceGitHubApp,
  getWorkspaceGitHubApp,
  getWorkspaceGitHubAppByInstallationId,
  inspectWorkspaceGitHubAppInstallationAccess,
  normalizeGitHubOrg,
  parseWorkspaceGitHubAppConfigJson,
  setWorkspaceGitHubAppInstallation,
  upsertWorkspaceGitHubApp
} from "../../services/connectors/github/workspace-github-app.js";
import {
  listGitHubBindingsByInstallationId,
  normalizeGitHubConnectorConfig,
  processGitHubWebhookForBinding
} from "../../services/connectors/github/index.js";
import { assertWorkspaceMember, assertWorkspaceOwner } from "../../services/workspaces/workspace-access.js";
import { workspaceParams, connectorsUiUrlForWorkspace, connectorToolOptionsSchema, type WorkspaceGitHubRoleRow } from "./shared.js";
import { normalizeConnectorAgentId } from "../../services/connectors/connector-agent.js";
import { normalizeConnectorToolOptionsConfig } from "../../services/connectors/connector-tools.js";
import { isEnvironmentMemoryEnabled } from "../../services/environments/environment-memory.js";

function buildDesktopGitHubInstallCallbackHtml(status: "success" | "error"): string {
  const title = status === "success" ? "GitHub connected" : "GitHub installation failed";
  const message = status === "success"
    ? "The GitHub App installation is connected. You can return to Meowbert Desktop and refresh this workspace."
    : "The GitHub App installation was cancelled or failed. Return to Meowbert Desktop and try again.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0c1220;
        color: #f6f8ff;
      }
      .card {
        width: min(560px, calc(100vw - 2rem));
        padding: 2rem;
        border-radius: 20px;
        border: 1px solid rgba(116, 167, 255, 0.2);
        background: rgba(16, 24, 39, 0.94);
        box-shadow: 0 24px 60px rgba(2, 8, 20, 0.45);
      }
      h1 {
        margin: 0 0 0.8rem;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
        color: #c7d2ea;
        line-height: 1.55;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

export const githubConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/workspaces/:wsId/connectors/github",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = workspaceParams.parse(request.params);
      await assertWorkspaceMember(params.wsId, request.user.id);

      const [memberRoleRes, appConfig] = await Promise.all([
        query<WorkspaceGitHubRoleRow>(
          `SELECT role
             FROM workspace_members
            WHERE workspace_id = $1
              AND user_id = $2
            LIMIT 1`,
          [params.wsId, request.user.id]
        ),
        getWorkspaceGitHubApp(params.wsId)
      ]);

      const canManage = memberRoleRes.rows[0]?.role === "owner";
      const access = appConfig?.installation_id
        ? await inspectWorkspaceGitHubAppInstallationAccess(appConfig)
        : null;
      return reply.send({
        enabled: isGitHubConnectorEnabled(),
        canManage,
        setup: {
          callbackUrl: getGitHubInstallCallbackUrl(),
          webhookUrl: getGitHubCentralWebhookUrl(),
          requiredEvents: ["issue_comment", "pull_request_review_comment"]
        },
        app: appConfig
          ? {
              configured: true,
              appId: appConfig.app_id,
              appSlug: appConfig.app_slug,
              defaultOrg: appConfig.default_org,
              hasPrivateKeyPem: appConfig.private_key_pem.trim().length > 0,
              hasWebhookSecret: appConfig.webhook_secret.trim().length > 0,
              hasClientId: typeof appConfig.client_id === "string" && appConfig.client_id.trim().length > 0,
              hasClientSecret:
                typeof appConfig.client_secret === "string" && appConfig.client_secret.trim().length > 0,
              updatedAt: appConfig.updated_at
            }
          : {
              configured: false
            },
        installation: appConfig && appConfig.installation_id
          ? {
              connected: true,
              installationId: appConfig.installation_id,
              accountLogin: appConfig.installation_account_login,
              accountType: appConfig.installation_account_type,
              connectedAt: appConfig.installation_connected_at,
              access
            }
          : {
              connected: false
            },
      });
    }
  );

  fastify.put(
    "/api/workspaces/:wsId/connectors/github/app",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!isGitHubConnectorEnabled()) {
        return reply.status(400).send({ error: "GitHub connector is disabled on this server" });
      }

      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const body = z
        .object({
          configJson: z.string().min(2)
        })
        .parse(request.body);

      try {
        const parsedConfig = parseWorkspaceGitHubAppConfigJson(body.configJson);
        const appConfig = await upsertWorkspaceGitHubApp({
          workspaceId: params.wsId,
          configuredByUserId: request.user.id,
          appId: parsedConfig.appId,
          appSlug: parsedConfig.appSlug,
          privateKeyPem: parsedConfig.privateKeyPem,
          webhookSecret: parsedConfig.webhookSecret,
          clientId: parsedConfig.clientId,
          clientSecret: parsedConfig.clientSecret,
          defaultOrg: parsedConfig.defaultOrg
        });

        return reply.send({
          ok: true,
          app: {
            appId: appConfig.app_id,
            appSlug: appConfig.app_slug,
            defaultOrg: appConfig.default_org,
            hasPrivateKeyPem: appConfig.private_key_pem.trim().length > 0,
            hasWebhookSecret: appConfig.webhook_secret.trim().length > 0,
            hasClientId: typeof appConfig.client_id === "string" && appConfig.client_id.trim().length > 0,
            hasClientSecret:
              typeof appConfig.client_secret === "string" && appConfig.client_secret.trim().length > 0,
            installationConnected: typeof appConfig.installation_id === "string",
            updatedAt: appConfig.updated_at
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({ error: message });
      }
    }
  );

  fastify.post(
    "/api/workspaces/:wsId/connectors/github/install/existing",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!isGitHubConnectorEnabled()) {
        return reply.status(400).send({ error: "GitHub connector is disabled on this server" });
      }

      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      try {
        const appConfig = await connectWorkspaceGitHubExistingInstallation(params.wsId);
        return reply.send({
          ok: true,
          installation: {
            connected: true,
            installationId: appConfig.installation_id,
            accountLogin: appConfig.installation_account_login,
            accountType: appConfig.installation_account_type,
            connectedAt: appConfig.installation_connected_at
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(409).send({ error: message });
      }
    }
  );

  fastify.post(
    "/api/workspaces/:wsId/connectors/github/install/start",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!isGitHubConnectorEnabled()) {
        return reply.status(400).send({ error: "GitHub connector is disabled on this server" });
      }

      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const body = z
        .object({
          returnOrigin: z.string().optional()
        })
        .default({})
        .parse(request.body);

      const appConfig = await getWorkspaceGitHubApp(params.wsId);
      if (!appConfig) {
        return reply.status(409).send({ error: "Save GitHub App credentials for this workspace first." });
      }

      try {
        const state = generateGitHubInstallState();
        const normalizedReturnOrigin = normalizeInstallReturnOrigin(body.returnOrigin ?? null);
        const expiresAt = await createWorkspaceGitHubInstallState({
          state,
          workspaceId: params.wsId,
          userId: request.user.id,
          returnOrigin: normalizedReturnOrigin,
          ttlMinutes: GITHUB_INSTALL_STATE_TTL_MINUTES
        });

        const installUrl = buildWorkspaceGitHubInstallRedirectUrl({
          appSlug: appConfig.app_slug,
          state
        });

        return reply.send({
          installUrl,
          expiresAt
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({ error: message });
      }
    }
  );

  fastify.post(
    "/api/workspaces/:wsId/connectors/github",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!isGitHubConnectorEnabled()) {
        return reply.status(400).send({ error: "GitHub connector is disabled on this server" });
      }

      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const body = z
        .object({
          defaultEnvironmentId: z.string().uuid(),
          agentId: z.string().max(200).nullable().optional(),
          tools: connectorToolOptionsSchema.optional(),
          prefixEnabled: z.boolean().default(true),
          keywordEnabled: z.boolean().default(true),
          llmFallbackEnabled: z.boolean().default(true)
        })
        .parse(request.body);

      const appConfig = await getWorkspaceGitHubApp(params.wsId);
      if (!appConfig) {
        return reply.status(409).send({
          error: "Save GitHub App credentials for this workspace before enabling the GitHub connector."
        });
      }
      if (!appConfig.installation_id) {
        return reply.status(409).send({
          error: "Install the GitHub App for this workspace before enabling the GitHub connector."
        });
      }

      const mentionLogin = appConfig.app_slug.trim().toLowerCase();
      const memoryEnabled = await isEnvironmentMemoryEnabled(body.defaultEnvironmentId);
      if (!mentionLogin) {
        return reply.status(409).send({
          error: "Configured GitHub App slug is invalid."
        });
      }

      const connectorConfig = normalizeGitHubConnectorConfig({
        mentionLogin,
        defaultEnvironmentId: body.defaultEnvironmentId,
        agentId: normalizeConnectorAgentId(body.agentId),
        tools: normalizeConnectorToolOptionsConfig(body.tools, memoryEnabled),
        prefixEnabled: body.prefixEnabled,
        keywordEnabled: body.keywordEnabled,
        llmFallbackEnabled: body.llmFallbackEnabled
      });

      const result = await query<{ id: string }>(
        `INSERT INTO connector_bindings (workspace_id, type, status, config_json)
         VALUES ($1, 'github', 'active', $2::jsonb)
         ON CONFLICT (workspace_id, type)
         DO UPDATE SET
           status = 'active',
           config_json = EXCLUDED.config_json,
           updated_at = now()
         RETURNING id`,
        [params.wsId, JSON.stringify(connectorConfig)]
      );

      return reply.send({
        id: result.rows[0].id,
        webhookUrl: getGitHubCentralWebhookUrl(),
        mentionLogin
      });
    }
  );

  fastify.patch(
    "/api/workspaces/:wsId/connectors/github",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const body = z
        .object({
          defaultOrg: z.string().max(39).nullable().optional()
        })
        .parse(request.body);

      const normalizedDefaultOrg = normalizeGitHubOrg(body.defaultOrg ?? null);
      const result = await query<{ default_org: string | null }>(
        `UPDATE workspace_github_apps
            SET default_org = $2,
                updated_at = now()
          WHERE workspace_id = $1
          RETURNING default_org`,
        [params.wsId, normalizedDefaultOrg]
      );

      if ((result.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "No GitHub App is configured for this workspace" });
      }

      return reply.send({
        ok: true,
        defaultOrg: result.rows[0].default_org
      });
    }
  );

  fastify.delete(
    "/api/workspaces/:wsId/connectors/github",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      await deleteWorkspaceGitHubApp(params.wsId);
      await query(
        `DELETE FROM connector_bindings
          WHERE workspace_id = $1
            AND type = 'github'`,
        [params.wsId]
      );

      return reply.send({ ok: true });
    }
  );

  fastify.get("/api/connectors/github/install/callback", async (request, reply) => {
    const callback = z
      .object({
        state: z.string().min(1).optional(),
        installation_id: z.coerce.number().int().positive().optional(),
        setup_action: z.string().optional()
      })
      .parse(request.query);

    if (!callback.state) {
      return reply.status(400).send({ error: "Missing GitHub install state" });
    }

    const consumedState = await consumeWorkspaceGitHubInstallState(callback.state);
    if (!consumedState) {
      return reply.status(400).send({ error: "GitHub install state is invalid or expired" });
    }

    const isDesktopReturnOrigin = consumedState.returnOrigin === DESKTOP_GITHUB_RETURN_ORIGIN;
    const errorRedirect = isDesktopReturnOrigin
      ? null
      : connectorsUiUrlForWorkspace(
          consumedState.returnOrigin,
          consumedState.workspaceId,
          "error"
        );

    if (!callback.installation_id) {
      if (isDesktopReturnOrigin) {
        return reply.type("text/html").send(buildDesktopGitHubInstallCallbackHtml("error"));
      }
      return reply.redirect(errorRedirect!);
    }

    try {
      const appConfig = await getWorkspaceGitHubApp(consumedState.workspaceId);
      if (!appConfig) {
        if (isDesktopReturnOrigin) {
          return reply.type("text/html").send(buildDesktopGitHubInstallCallbackHtml("error"));
        }
        return reply.redirect(errorRedirect!);
      }

      const appId = Number.parseInt(appConfig.app_id, 10);
      if (!Number.isInteger(appId) || appId <= 0) {
        if (isDesktopReturnOrigin) {
          return reply.type("text/html").send(buildDesktopGitHubInstallCallbackHtml("error"));
        }
        return reply.redirect(errorRedirect!);
      }

      const installation = await fetchGitHubInstallationDetails({
        appId,
        privateKeyPem: appConfig.private_key_pem,
        installationId: callback.installation_id
      });

      await setWorkspaceGitHubAppInstallation({
        workspaceId: consumedState.workspaceId,
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType
      });
    } catch {
      if (isDesktopReturnOrigin) {
        return reply.type("text/html").send(buildDesktopGitHubInstallCallbackHtml("error"));
      }
      return reply.redirect(errorRedirect!);
    }

    if (isDesktopReturnOrigin) {
      return reply.type("text/html").send(buildDesktopGitHubInstallCallbackHtml("success"));
    }

    return reply.redirect(
      connectorsUiUrlForWorkspace(consumedState.returnOrigin, consumedState.workspaceId, "success")
    );
  });

  fastify.post("/api/connectors/github/webhook", async (request, reply) => {
    if (!isGitHubConnectorEnabled()) {
      return reply.status(404).send({ error: "GitHub connector is disabled" });
    }

    const eventHeader = request.headers["x-github-event"];
    const eventName = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
    if (!eventName || typeof eventName !== "string") {
      return reply.status(400).send({ error: "Missing GitHub event header" });
    }

    const signatureHeaderRaw = request.headers["x-hub-signature-256"];
    const signatureHeader = Array.isArray(signatureHeaderRaw)
      ? signatureHeaderRaw[0]
      : signatureHeaderRaw ?? null;
    if (typeof signatureHeader !== "string") {
      return reply.status(400).send({ error: "Missing GitHub webhook signature" });
    }

    const payload = request.body as Record<string, unknown> | null;
    const installationRecord =
      payload &&
      typeof payload === "object" &&
      payload.installation &&
      typeof payload.installation === "object"
        ? (payload.installation as Record<string, unknown>)
        : null;
    const installationId =
      typeof installationRecord?.id === "number" &&
      Number.isInteger(installationRecord.id) &&
      installationRecord.id > 0
        ? installationRecord.id
        : null;
    if (!installationId) {
      return reply.send({ ok: true });
    }

    const appConfig = await getWorkspaceGitHubAppByInstallationId(installationId);
    if (!appConfig) {
      return reply.status(404).send({ error: "GitHub installation is not connected to any workspace" });
    }

    const rawBody = (request as { rawBody?: string }).rawBody;
    if (typeof rawBody !== "string") {
      return reply.status(400).send({ error: "Missing raw webhook payload" });
    }
    if (!verifyGitHubWebhookSignature({
      rawBody,
      webhookSecret: appConfig.webhook_secret,
      signatureHeader
    })) {
      return reply.status(401).send({ error: "Invalid GitHub webhook signature" });
    }

    const bindings = await listGitHubBindingsByInstallationId(installationId);
    if (bindings.length === 0) {
      return reply.send({ ok: true });
    }

    for (const binding of bindings) {
      if (binding.status !== "active") {
        continue;
      }

      const processed = await processGitHubWebhookForBinding({
        binding,
        eventName,
        payload
      });
      if (processed.processed) {
        return reply.send({
          ok: true,
          taskId: processed.taskId,
          environmentId: processed.environmentId,
          action: processed.action
        });
      }
    }

    return reply.send({ ok: true });
  });
};
