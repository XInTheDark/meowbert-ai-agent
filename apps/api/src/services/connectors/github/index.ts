import { query } from "../../../lib/db.js";
import { normalizeConnectorAgentId } from "../connector-agent.js";
import { describeConnectorExecutionError } from "../connector-execution-errors.js";
import {
  consumeConnectorPairCodeIfPresent,
  resolveConnectorPairedUserId
} from "../connector-pairing.js";
import {
  deliverConnectorMessageToMaster,
  resolveConnectorMasterTarget,
  type ConnectorIngestResult
} from "../connector-master-ingest.js";
import {
  connectorThreadHasInboundMessages,
  findConnectorThread,
  getOrCreateConnectorThread,
  isConnectorThreadMidConversation,
  resolveConnectorTaskFromExternalMessage
} from "../connector-threads.js";
import {
  buildGitHubMessageWithMetadata,
  buildThreadId,
  commentMentionsLogin,
  injectGitHubThreadHistoryIntoMessage,
  pairingAttemptMessage,
  parseInboundCommentEvent
} from "./events.js";
import { maybeBuildGitHubThreadHistory, sendGitHubIssueComment } from "./github-api.js";
import { normalizeBindingConfig, normalizeGitHubLogin } from "./shared.js";

export interface GitHubBindingRow {
  id: string;
  workspace_id: string;
  config_json: Record<string, unknown>;
  status: string;
}

export type GitHubWebhookProcessResult = ConnectorIngestResult;

async function maybeHandleGitHubExecutionError(input: {
  error: unknown;
  workspaceId: string;
  repositoryFullName: string;
  issueNumber: number;
}): Promise<boolean> {
  const message = describeConnectorExecutionError(input.error);
  if (!message) {
    return false;
  }

  await sendGitHubIssueComment({
    workspaceId: input.workspaceId,
    repositoryFullName: input.repositoryFullName,
    issueNumber: input.issueNumber,
    text: message
  });
  return true;
}

export async function listGitHubBindingsByInstallationId(
  installationId: number
): Promise<GitHubBindingRow[]> {
  const result = await query<GitHubBindingRow>(
    `SELECT cb.id, cb.workspace_id, cb.config_json, cb.status
       FROM connector_bindings cb
       JOIN workspace_github_apps wga
         ON wga.workspace_id = cb.workspace_id
      WHERE cb.type = 'github'
        AND wga.installation_id = $1
      ORDER BY cb.updated_at DESC, cb.created_at DESC, cb.id ASC`,
    [installationId]
  );

  return result.rows;
}

export async function getGitHubBindingByInstallationId(
  installationId: number
): Promise<GitHubBindingRow | null> {
  const bindings = await listGitHubBindingsByInstallationId(installationId);
  return bindings[0] ?? null;
}

export async function processGitHubWebhookForBinding(input: {
  binding: GitHubBindingRow;
  eventName: string;
  payload: unknown;
}): Promise<GitHubWebhookProcessResult> {
  const inbound = parseInboundCommentEvent(input.eventName, input.payload);
  if (!inbound) {
    return { processed: false };
  }

  if (inbound.action !== "created") {
    return { processed: false };
  }

  const bindingConfig = normalizeBindingConfig(input.binding.config_json);
  if (!inbound.commentBody.trim()) {
    return { processed: false };
  }

  const messageText = inbound.commentBody.trim();
  const externalThreadId = buildThreadId(inbound);
  const existingThread = await findConnectorThread({
    bindingId: input.binding.id,
    externalChatId: inbound.repositoryFullName,
    externalThreadId
  });
  const hasOngoingThreadTask = existingThread
    ? await isConnectorThreadMidConversation(existingThread.id)
    : false;

  const mentionLogin = bindingConfig.mentionLogin;

  if (!mentionLogin && !hasOngoingThreadTask) {
    return { processed: false };
  }

  const pairingAttempt = await consumeConnectorPairCodeIfPresent({
    bindingId: input.binding.id,
    workspaceId: input.binding.workspace_id,
    externalUserId: inbound.authorId,
    messageText
  });

  if (pairingAttempt.handled) {
    await sendGitHubIssueComment({
      workspaceId: input.binding.workspace_id,
      repositoryFullName: inbound.repositoryFullName,
      issueNumber: inbound.issueNumber,
      text: pairingAttemptMessage(pairingAttempt.outcome)
    });
    return { processed: false };
  }

  if (!hasOngoingThreadTask && mentionLogin && !commentMentionsLogin(inbound.commentBody, mentionLogin)) {
    return { processed: false };
  }

  if (mentionLogin && inbound.authorLogin && inbound.authorLogin === mentionLogin) {
    return { processed: false };
  }

  const actorUserId = await resolveConnectorPairedUserId({
    bindingId: input.binding.id,
    externalUserId: inbound.authorId
  });
  if (!actorUserId) {
    return { processed: false };
  }

  const thread = await getOrCreateConnectorThread({
    bindingId: input.binding.id,
    workspaceId: input.binding.workspace_id,
    externalChatId: inbound.repositoryFullName,
    externalThreadId
  });

  const alreadyLinkedTaskId = await resolveConnectorTaskFromExternalMessage({
    threadId: thread.id,
    workspaceId: input.binding.workspace_id,
    externalMessageId: inbound.commentId
  });
  if (alreadyLinkedTaskId) {
    return { processed: false };
  }

  try {
    const target = await resolveConnectorMasterTarget({
      source: "github",
      workspaceId: input.binding.workspace_id,
      actorUserId,
      defaultEnvironmentId: bindingConfig.defaultEnvironmentId ?? null,
      routingText: messageText
    });
    const inboundMessage = buildGitHubMessageWithMetadata({
      text: messageText,
      event: inbound
    });
    const threadHistory = (await connectorThreadHasInboundMessages(thread.id))
      ? null
      : await maybeBuildGitHubThreadHistory({
          workspaceId: input.binding.workspace_id,
          repositoryFullName: inbound.repositoryFullName,
          issueNumber: inbound.issueNumber,
          pullRequestNumber: inbound.pullRequestNumber,
          currentCommentId: inbound.commentId
        });

    return await deliverConnectorMessageToMaster({
      target,
      threadId: thread.id,
      inboundMessageId: inbound.commentId,
      message: injectGitHubThreadHistoryIntoMessage(inboundMessage, threadHistory),
      toolsConfig: bindingConfig.tools,
      agentId: bindingConfig.agentId
    });
  } catch (error) {
    if (await maybeHandleGitHubExecutionError({
      error,
      workspaceId: input.binding.workspace_id,
      repositoryFullName: inbound.repositoryFullName,
      issueNumber: inbound.issueNumber
    })) {
      return { processed: false };
    }
    throw error;
  }
}

export function normalizeGitHubConnectorConfig(input: {
  mentionLogin: string;
  defaultEnvironmentId: string;
  agentId?: string | null;
  tools?: unknown;
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
}): Record<string, unknown> {
  return {
    connectionMode: "custom",
    mode: "webhook",
    mentionLogin: normalizeGitHubLogin(input.mentionLogin),
    defaultEnvironmentId: input.defaultEnvironmentId,
    agentId: normalizeConnectorAgentId(input.agentId),
    tools: input.tools,
    prefixEnabled: input.prefixEnabled,
    keywordEnabled: input.keywordEnabled,
    llmFallbackEnabled: input.llmFallbackEnabled
  };
}
