import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../../lib/config.js";
import {
  findWorkspaceEmailConnectorByRecipient,
  getWorkspaceEmailConnector,
  upsertWorkspaceEmailConnector,
  disableWorkspaceEmailConnector,
  shouldAllowEmailSender,
  buildWorkspaceEmailAddress,
  sanitizeLocalPartFromUserInput,
  AUTO_LOCAL_PART_SENTINEL
} from "../../services/connectors/email/workspace-email-connector.js";
import { normalizeConnectorToolOptionsConfig } from "../../services/connectors/connector-tools.js";
import { isEnvironmentMemoryEnabled } from "../../services/environments/environment-memory.js";
import { getEmailInboundSettings } from "../../services/connectors/email/inbound-settings.js";
import { parseBrevoInboundPayload, type BrevoInboundMessage } from "../../services/connectors/email/brevo-inbound.js";
import { appendEmailInboundDebugEvent } from "../../services/connectors/email/inbound-debug-events.js";
import { processInboundEmailForWorkspace } from "../../services/connectors/email/inbound-ingest.js";
import { parseTrustedSenderList } from "../../services/connectors/email/address-utils.js";
import { assertWorkspaceMember, assertWorkspaceOwner } from "../../services/workspaces/workspace-access.js";
import { query } from "../../lib/db.js";
import { workspaceParams, asRecord, connectorToolOptionsSchema, type WorkspaceMemberRoleRow } from "./shared.js";

interface WorkspaceEmailConnectorStatusResponse {
  enabled: boolean;
  canManage: boolean;
  admin: {
    enabled: boolean;
    inboundDomain: string | null;
    addressMode: "random" | "workspace_custom";
    hasWebhookSecret: boolean;
    hasBrevoApiKey: boolean;
  };
  connector:
    | {
        connected: false;
      }
    | {
        connected: true;
        status: string;
        localPart: string;
        emailAddress: string | null;
        senderPolicy: "allow_any" | "trusted_only";
        trustedSenders: string[];
        defaultEnvironmentId: string | null;
        agentId: string | null;
        tools: {
          webSearch: boolean;
          memorySearch: boolean;
          scheduleTask: boolean;
          subtasks: boolean;
          computerUse: boolean;
          enabledSkills: string[];
          enabledSources: string[];
        };
        prefixEnabled: boolean;
        keywordEnabled: boolean;
        llmFallbackEnabled: boolean;
      };
}

function summarizeBrevoInboundPayloadShape(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      bodyType: Array.isArray(payload) ? "array" : typeof payload
    };
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).slice(0, 50);
  const wrappedItemsArray = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.Items)
      ? record.Items
      : null;
  const wrappedItems = wrappedItemsArray
    ? wrappedItemsArray.length
    : null;
  const firstWrappedItem = wrappedItemsArray && wrappedItemsArray.length > 0
    ? asRecord(wrappedItemsArray[0])
    : null;

  const fromShapeRaw = firstWrappedItem?.From ?? firstWrappedItem?.from ?? firstWrappedItem?.Sender ?? firstWrappedItem?.sender;
  const recipientsShapeRaw = firstWrappedItem?.To
    ?? firstWrappedItem?.to
    ?? firstWrappedItem?.Recipients
    ?? firstWrappedItem?.recipients
    ?? firstWrappedItem?.Recipient
    ?? firstWrappedItem?.recipient;
  const messageIdRaw = firstWrappedItem?.MessageId
    ?? firstWrappedItem?.MessageID
    ?? firstWrappedItem?.messageId
    ?? firstWrappedItem?.message_id
    ?? firstWrappedItem?.MessageUUID
    ?? firstWrappedItem?.messageUuid
    ?? firstWrappedItem?.uuid;

  const summarizeShape = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `array(len=${value.length})`;
    }
    if (value === null) {
      return "null";
    }
    if (typeof value === "object") {
      const objectValue = asRecord(value);
      if (!objectValue) {
        return "object";
      }
      return `object(keys=${Object.keys(objectValue).slice(0, 8).join(",") || "-"})`;
    }
    if (typeof value === "string") {
      return `string(len=${value.length})`;
    }
    return typeof value;
  };

  const firstItemKeys = firstWrappedItem
    ? Object.keys(firstWrappedItem).slice(0, 50)
    : null;

  return {
    bodyType: "object",
    keys,
    wrappedItems,
    firstItemKeys,
    firstItemMessageIdShape: summarizeShape(messageIdRaw),
    firstItemFromShape: summarizeShape(fromShapeRaw),
    firstItemRecipientsShape: summarizeShape(recipientsShapeRaw),
    hasHeaders: Boolean(record.Headers ?? record.headers ?? firstWrappedItem?.Headers ?? firstWrappedItem?.headers),
    hasAttachments: Array.isArray(record.Attachments)
      || Array.isArray(record.attachments)
      || Boolean(firstWrappedItem && (Array.isArray(firstWrappedItem.Attachments) || Array.isArray(firstWrappedItem.attachments)))
  };
}

function summarizeInboundMessage(input: BrevoInboundMessage): Record<string, unknown> {
  return {
    messageId: input.messageId,
    fromEmail: input.fromEmail,
    recipients: input.recipients,
    subject: input.subject,
    receivedAt: input.receivedAt,
    replyReferenceIds: input.replyReferenceIds,
    attachmentCount: input.attachments.length,
    textBodyLength: input.textBody?.length ?? 0,
    htmlBodyLength: input.htmlBody?.length ?? 0
  };
}

export const emailConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/workspaces/:wsId/connectors/email",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = workspaceParams.parse(request.params);
      await assertWorkspaceMember(params.wsId, request.user.id);

      const [memberRoleRes, adminSettings, connector] = await Promise.all([
        query<WorkspaceMemberRoleRow>(
          `SELECT role
             FROM workspace_members
            WHERE workspace_id = $1
              AND user_id = $2
            LIMIT 1`,
          [params.wsId, request.user.id]
        ),
        getEmailInboundSettings(),
        getWorkspaceEmailConnector(params.wsId)
      ]);

      const canManage = memberRoleRes.rows[0]?.role === "owner";
      const emailAddress = connector
        ? buildWorkspaceEmailAddress(connector.localPart, adminSettings.inboundDomain)
        : null;

      const response: WorkspaceEmailConnectorStatusResponse = {
        enabled: config.connectors.email.enabled,
        canManage,
        admin: {
          enabled: adminSettings.enabled,
          inboundDomain: adminSettings.inboundDomain,
          addressMode: adminSettings.addressMode,
          hasWebhookSecret: adminSettings.hasWebhookSecret,
          hasBrevoApiKey: adminSettings.hasBrevoApiKey
        },
        connector: connector
          ? {
              connected: true,
              status: connector.status,
              localPart: connector.localPart,
              emailAddress,
              senderPolicy: connector.senderPolicy,
              trustedSenders: connector.trustedSenders,
              defaultEnvironmentId: connector.defaultEnvironmentId,
              agentId: connector.agentId,
              tools: connector.tools,
              prefixEnabled: connector.prefixEnabled,
              keywordEnabled: connector.keywordEnabled,
              llmFallbackEnabled: connector.llmFallbackEnabled
            }
          : {
              connected: false
            }
      };

      return reply.send(response);
    }
  );

  fastify.post(
    "/api/workspaces/:wsId/connectors/email",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!config.connectors.email.enabled) {
        return reply.status(400).send({ error: "Email connector is disabled on this server" });
      }

      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const body = z
        .object({
          localPart: z.string().max(120).nullable().optional(),
          senderPolicy: z.enum(["allow_any", "trusted_only"]).optional(),
          trustedAddresses: z.string().max(4_000).nullable().optional(),
          defaultEnvironmentId: z.string().uuid().nullable().optional(),
          agentId: z.string().max(200).nullable().optional(),
          tools: connectorToolOptionsSchema.optional(),
          prefixEnabled: z.boolean().optional(),
          keywordEnabled: z.boolean().optional(),
          llmFallbackEnabled: z.boolean().optional()
        })
        .parse(request.body);

      const [adminSettings, existing] = await Promise.all([
        getEmailInboundSettings(),
        getWorkspaceEmailConnector(params.wsId)
      ]);

      if (!adminSettings.enabled || !adminSettings.inboundDomain) {
        return reply.status(409).send({
          error: "Email inbound is not enabled by the platform admin."
        });
      }

      if (!adminSettings.hasWebhookSecret || !adminSettings.hasBrevoApiKey) {
        return reply.status(409).send({
          error: "Email inbound setup is incomplete. Ask the platform admin to finish Brevo settings."
        });
      }

      const desiredLocalPart = sanitizeLocalPartFromUserInput(body.localPart ?? null);
      const localPart =
        adminSettings.addressMode === "workspace_custom"
          ? desiredLocalPart ?? existing?.localPart ?? null
          : existing?.localPart ?? AUTO_LOCAL_PART_SENTINEL;

      if (!localPart) {
        return reply.status(400).send({
          error: "Email local-part is required. Ask the workspace owner to set one."
        });
      }

      const senderPolicy = body.senderPolicy ?? existing?.senderPolicy ?? "allow_any";
      const trustedAddressesRaw = body.trustedAddresses;
      const trustedSenders =
        trustedAddressesRaw === undefined
          ? (existing?.trustedSenders ?? [])
          : parseTrustedSenderList(trustedAddressesRaw ?? "");

      if (senderPolicy === "trusted_only" && trustedSenders.length === 0) {
        return reply.status(400).send({
          error: "Trusted sender mode requires at least one trusted address."
        });
      }

      const defaultEnvironmentId =
        body.defaultEnvironmentId === undefined
          ? existing?.defaultEnvironmentId ?? null
          : body.defaultEnvironmentId;

      const agentId = body.agentId === undefined ? existing?.agentId ?? null : body.agentId;
      const memoryEnabled = defaultEnvironmentId ? await isEnvironmentMemoryEnabled(defaultEnvironmentId) : false;
      const tools = normalizeConnectorToolOptionsConfig(
        body.tools === undefined ? existing?.tools : body.tools,
        memoryEnabled
      );
      const prefixEnabled = body.prefixEnabled ?? existing?.prefixEnabled ?? true;
      const keywordEnabled = body.keywordEnabled ?? existing?.keywordEnabled ?? true;
      const llmFallbackEnabled = body.llmFallbackEnabled ?? existing?.llmFallbackEnabled ?? true;

      try {
        const connector = await upsertWorkspaceEmailConnector({
          workspaceId: params.wsId,
          localPart,
          senderPolicy,
          trustedSenders,
          defaultEnvironmentId,
          agentId,
          tools,
          prefixEnabled,
          keywordEnabled,
          llmFallbackEnabled,
          updatedByUserId: request.user.id
        });

        return reply.send({
          id: connector.bindingId,
          status: connector.status,
          localPart: connector.localPart,
          emailAddress: buildWorkspaceEmailAddress(connector.localPart, adminSettings.inboundDomain),
          senderPolicy: connector.senderPolicy,
          trustedSenders: connector.trustedSenders,
          defaultEnvironmentId: connector.defaultEnvironmentId,
          agentId: connector.agentId,
          tools: connector.tools,
          prefixEnabled: connector.prefixEnabled,
          keywordEnabled: connector.keywordEnabled,
          llmFallbackEnabled: connector.llmFallbackEnabled
        });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
          return reply.status(409).send({ error: "That email local-part is already in use by another workspace." });
        }

        throw error;
      }
    }
  );

  fastify.delete(
    "/api/workspaces/:wsId/connectors/email",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      await disableWorkspaceEmailConnector(params.wsId);
      return reply.send({ ok: true });
    }
  );

  fastify.post("/api/connectors/email/inbound/brevo", async (request, reply) => {
    if (!config.connectors.email.enabled) {
      return reply.status(404).send({ error: "Email connector is disabled" });
    }

    const queryParams = z
      .object({
        token: z.string().min(1)
      })
      .parse(request.query);

    const adminSettings = await getEmailInboundSettings();
    const debugTraceId = randomUUID();
    const logInboundDebug = async (entry: {
      eventType: string;
      level?: "info" | "warn" | "error";
      message: string;
      workspaceId?: string | null;
      bindingId?: string | null;
      details?: Record<string, unknown>;
    }): Promise<void> => {
      if (!adminSettings.debugLoggingEnabled) {
        return;
      }

      try {
        await appendEmailInboundDebugEvent({
          provider: "brevo",
          workspaceId: entry.workspaceId ?? null,
          bindingId: entry.bindingId ?? null,
          eventType: entry.eventType,
          level: entry.level ?? "info",
          message: entry.message,
          details: {
            traceId: debugTraceId,
            ...entry.details
          }
        });
      } catch (error) {
        request.log.warn(
          {
            err: error,
            traceId: debugTraceId
          },
          "Failed to persist email inbound debug event"
        );
      }
    };

    if (!adminSettings.enabled || !adminSettings.webhookSecret) {
      return reply.status(404).send({ error: "Email inbound connector is disabled" });
    }

    if (queryParams.token !== adminSettings.webhookSecret) {
      await logInboundDebug({
        eventType: "auth_failed",
        level: "warn",
        message: "Inbound webhook rejected due to invalid token.",
        details: {
          providedTokenLength: queryParams.token.length
        }
      });
      return reply.status(401).send({ error: "Invalid inbound token" });
    }

    await logInboundDebug({
      eventType: "request_received",
      message: "Inbound webhook request accepted for processing.",
      details: summarizeBrevoInboundPayloadShape(request.body)
    });

    const inbound = parseBrevoInboundPayload(request.body);
    if (!inbound) {
      await logInboundDebug({
        eventType: "payload_ignored",
        level: "warn",
        message: "Inbound payload did not include a parseable email message.",
        details: summarizeBrevoInboundPayloadShape(request.body)
      });
      return reply.send({ ok: true });
    }
    await logInboundDebug({
      eventType: "payload_parsed",
      message: "Parsed inbound email payload.",
      details: summarizeInboundMessage(inbound)
    });

    const inboundDomain = adminSettings.inboundDomain;
    if (!inboundDomain) {
      await logInboundDebug({
        eventType: "config_error",
        level: "error",
        message: "Inbound domain is not configured; message was ignored.",
        details: {
          messageId: inbound.messageId
        }
      });
      return reply.send({ ok: true });
    }

    let matchedRecipient: string | null = null;
    let connector: Awaited<ReturnType<typeof findWorkspaceEmailConnectorByRecipient>> = null;
    for (const recipient of inbound.recipients) {
      const matched = await findWorkspaceEmailConnectorByRecipient({
        recipientEmail: recipient,
        inboundDomain
      });
      if (matched) {
        matchedRecipient = recipient;
        connector = matched;
        break;
      }
    }

    if (!connector || !matchedRecipient) {
      await logInboundDebug({
        eventType: "recipient_unmatched",
        level: "warn",
        message: "Inbound recipient does not map to any active workspace email connector.",
        details: {
          messageId: inbound.messageId,
          recipients: inbound.recipients,
          inboundDomain
        }
      });
      return reply.send({ ok: true });
    }

    if (!shouldAllowEmailSender({
      senderPolicy: connector.senderPolicy,
      trustedSenders: connector.trustedSenders,
      senderEmail: inbound.fromEmail
    })) {
      await logInboundDebug({
        eventType: "sender_blocked",
        level: "warn",
        message: "Inbound sender is blocked by workspace trusted sender policy.",
        workspaceId: connector.workspaceId,
        bindingId: connector.bindingId,
        details: {
          messageId: inbound.messageId,
          recipient: matchedRecipient,
          sender: inbound.fromEmail,
          senderPolicy: connector.senderPolicy,
          trustedSenderCount: connector.trustedSenders.length
        }
      });
      return reply.send({ ok: true });
    }

    if (!adminSettings.brevoApiKey) {
      await logInboundDebug({
        eventType: "config_error",
        level: "error",
        message: "Brevo API key is missing; attachments cannot be downloaded and message cannot be processed.",
        workspaceId: connector.workspaceId,
        bindingId: connector.bindingId,
        details: {
          messageId: inbound.messageId
        }
      });
      return reply.status(503).send({ error: "Brevo API key is not configured for inbound processing" });
    }

    const processed = await processInboundEmailForWorkspace({
      connector,
      inbound,
      recipientAddress: matchedRecipient,
      brevoApiKey: adminSettings.brevoApiKey,
      debugLog: async (entry) => {
        await logInboundDebug({
          ...entry,
          workspaceId: connector.workspaceId,
          bindingId: connector.bindingId
        });
      }
    });

    if (!processed.processed) {
      await logInboundDebug({
        eventType: "message_skipped",
        level: "warn",
        message: "Inbound message was acknowledged but not processed.",
        workspaceId: connector.workspaceId,
        bindingId: connector.bindingId,
        details: {
          messageId: inbound.messageId,
          reason: processed.reason ?? "unknown"
        }
      });
      return reply.send({ ok: true });
    }

    await logInboundDebug({
      eventType: "message_processed",
      message: "Inbound message processed successfully.",
      workspaceId: connector.workspaceId,
      bindingId: connector.bindingId,
      details: {
        messageId: inbound.messageId,
        taskId: processed.taskId,
        environmentId: processed.environmentId,
        action: processed.action
      }
    });

    return reply.send({
      ok: true,
      taskId: processed.taskId,
      environmentId: processed.environmentId,
      action: processed.action
    });
  });
};
