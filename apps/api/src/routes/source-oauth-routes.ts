import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  buildSourceCallbackUrl,
  consumeWorkspaceSourceOAuth,
  exchangeWorkspaceSourceOauthState
} from "../services/sources/oauth-flow.js";
import {
  clearSourceOauthBrowserCookie,
  readSourceOauthBrowserNonce
} from "../services/sources/oauth-browser-binding.js";
import {
  buildDesktopSourceCallbackHtml,
  buildWorkspaceSourcesUiUrl,
  DESKTOP_SOURCE_RETURN_ORIGIN
} from "../services/sources/oauth-helpers.js";
import { listAvailableWorkspaceSources } from "../services/sources/source-operations.js";
import { SOURCE_PROVIDERS } from "../services/sources/source-types.js";

const oauthCallbackParams = z.object({
  provider: z.enum(SOURCE_PROVIDERS)
});

const oauthCallbackQuery = z.object({
  state: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  error: z.string().optional(),
  hostname: z.string().optional(),
  locationid: z.string().optional()
});

export function registerSourceOauthRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/sources/oauth/:provider/callback", async (request, reply) => {
    const params = oauthCallbackParams.parse(request.params);
    const queryInput = oauthCallbackQuery.parse(request.query ?? {});

    if (!queryInput.state) {
      return reply.status(400).send({ error: "Missing source OAuth state" });
    }

    const secureCookie = new URL(buildSourceCallbackUrl(params.provider)).protocol === "https:";
    const browserNonce = readSourceOauthBrowserNonce(request.headers.cookie, queryInput.state);
    reply.header("set-cookie", clearSourceOauthBrowserCookie({
      provider: params.provider,
      state: queryInput.state,
      secure: secureCookie
    }));
    if (!browserNonce) {
      return reply.status(400).send({ error: "Source OAuth browser binding is missing or invalid" });
    }

    let oauthState;
    try {
      oauthState = await consumeWorkspaceSourceOAuth({
        provider: params.provider,
        state: queryInput.state,
        browserNonce
      });
    } catch {
      return reply.status(400).send({ error: "Source OAuth state is invalid or expired" });
    }

    const isDesktopReturn = oauthState.returnOrigin === DESKTOP_SOURCE_RETURN_ORIGIN;
    const sourceName = listAvailableWorkspaceSources().find((entry) => entry.provider === params.provider)?.manifest.name;
    const redirectToWorkspace = (status: "success" | "error") => {
      if (isDesktopReturn) {
        return reply.type("text/html").send(buildDesktopSourceCallbackHtml(status, sourceName));
      }
      return reply.redirect(buildWorkspaceSourcesUiUrl(oauthState.returnOrigin, oauthState.workspaceId, status));
    };

    if (queryInput.error || !queryInput.code) {
      return redirectToWorkspace("error");
    }

    try {
      const completed = await exchangeWorkspaceSourceOauthState({
        oauthState,
        code: queryInput.code,
        callbackQuery: {
          hostname: queryInput.hostname,
          locationid: queryInput.locationid
        }
      });
      if (isDesktopReturn) {
        return reply.type("text/html").send(buildDesktopSourceCallbackHtml("success", sourceName));
      }
      return reply.redirect(buildWorkspaceSourcesUiUrl(completed.returnOrigin, completed.workspaceId, "success"));
    } catch {
      return redirectToWorkspace("error");
    }
  });
}
