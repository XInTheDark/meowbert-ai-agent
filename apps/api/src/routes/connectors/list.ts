import type { FastifyPluginAsync } from "fastify";
import { query } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import { listSharedConnectorSettings, normalizeConnectorConnectionMode } from "../../services/connectors/shared-connectors.js";
import { getGitHubCentralWebhookUrl } from "../../services/connectors/github/app-auth.js";
import { assertWorkspaceMember } from "../../services/workspaces/workspace-access.js";
import { buildWorkspaceEmailAddress } from "../../services/connectors/email/workspace-email-connector.js";
import { getEmailInboundSettings } from "../../services/connectors/email/inbound-settings.js";
import { workspaceParams, buildTelegramWebhookUrl, type ConnectorBindingRow, type WorkspaceMemberRoleRow } from "./shared.js";

export const listConnectorsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/workspaces/:wsId/connectors",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = workspaceParams.parse(request.params);
      await assertWorkspaceMember(params.wsId, request.user.id);

      const [result, sharedSettings, workspaceMemberRoleRes, emailInboundSettings] = await Promise.all([
        query<ConnectorBindingRow>(
          `SELECT cb.id,
                  cb.type,
                  cb.status,
                  cb.config_json,
                  cp.paired_at,
                  wec.local_part AS email_local_part,
                  wec.sender_policy AS email_sender_policy,
                  wec.trusted_senders AS email_trusted_senders,
                  wec.default_environment_id AS email_default_environment_id,
                  wec.prefix_enabled AS email_prefix_enabled,
                  wec.keyword_enabled AS email_keyword_enabled,
                  wec.llm_fallback_enabled AS email_llm_fallback_enabled
             FROM connector_bindings cb
        LEFT JOIN connector_pairings cp
               ON cp.binding_id = cb.id
              AND cp.user_id = $2
        LEFT JOIN workspace_email_connectors wec
               ON wec.binding_id = cb.id
            WHERE cb.workspace_id = $1`,
          [params.wsId, request.user.id]
        ),
        listSharedConnectorSettings(),
        query<WorkspaceMemberRoleRow>(
          `SELECT role
             FROM workspace_members
            WHERE workspace_id = $1
              AND user_id = $2
            LIMIT 1`,
          [params.wsId, request.user.id]
        ),
        getEmailInboundSettings()
      ]);

      const canManageConnectors = workspaceMemberRoleRes.rows[0]?.role === "owner";

      return {
        items: result.rows.map(
          (row) => ({
            id: row.id,
            type: row.type,
            status: row.status,
            webhookUrl:
              row.type === "telegram"
                ? buildTelegramWebhookUrl(row.id)
                : row.type === "github"
                  ? canManageConnectors
                    ? getGitHubCentralWebhookUrl()
                    : null
                  : null,
            config: {
              ...row.config_json,
              ...(row.type === "email"
                ? {
                    localPart: row.email_local_part ?? null,
                    senderPolicy: row.email_sender_policy ?? "allow_any",
                    trustedSenders: row.email_trusted_senders ?? [],
                    defaultEnvironmentId: row.email_default_environment_id ?? null,
                    prefixEnabled: row.email_prefix_enabled !== false,
                    keywordEnabled: row.email_keyword_enabled !== false,
                    llmFallbackEnabled: row.email_llm_fallback_enabled !== false,
                    emailAddress: buildWorkspaceEmailAddress(
                      row.email_local_part ?? "",
                      emailInboundSettings.inboundDomain
                    )
                  }
                : {}),
              connectionMode: normalizeConnectorConnectionMode(row.config_json),
              mode:
                row.type === "telegram"
                  ? row.config_json.mode === "polling"
                    ? "polling"
                    : row.config_json.mode === "shared"
                      ? "shared"
                      : "webhook"
                  : row.type === "discord"
                    ? row.config_json.mode === "shared"
                      ? "shared"
                      : "gateway"
                    : row.type === "email"
                      ? "inbound"
                      : "webhook",
              botToken: row.config_json.botToken ? "***" : undefined
            },
            pairing: {
              paired: row.type === "email" ? true : typeof row.paired_at === "string",
              pairedAt: row.type === "email" ? null : row.paired_at ?? null
            }
          })
        ),
        shared: {
          canManageConnectors,
          telegram: {
            enabled: sharedSettings.telegram.enabled,
            hasToken: sharedSettings.telegram.hasToken
          },
          discord: {
            enabled: sharedSettings.discord.enabled,
            hasToken: sharedSettings.discord.hasToken
          },
          email: {
            enabled:
              config.connectors.email.enabled &&
              emailInboundSettings.enabled &&
              typeof emailInboundSettings.inboundDomain === "string" &&
              emailInboundSettings.inboundDomain.length > 0,
            inboundDomain: emailInboundSettings.inboundDomain,
            addressMode: emailInboundSettings.addressMode
          }
        }
      };
    }
  );
};
