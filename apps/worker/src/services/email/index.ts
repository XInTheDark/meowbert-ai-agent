import { buildEmailDeliveryQueueJobId } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";
import { emailQueue } from "../../lib/queue.js";

interface EmailThreadRow {
  id: string;
  workspace_id: string;
  external_chat_id: string;
  external_thread_id: string | null;
}

interface TaskWorkspaceRow {
  workspace_id: string;
  environment_id: string;
}

interface InboundMessageLinkRow {
  external_message_id: string;
}

export interface NotificationDeliveryResult {
  status: "sent" | "skipped" | "failed";
  channel: "email";
  detail?: string;
  externalMessageId?: string | null;
}

function normalizeEmailAddress(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const angleMatch = trimmed.match(/<([^>]+)>/);
  const candidate = (angleMatch?.[1] ?? trimmed).trim().toLowerCase();
  const atIndex = candidate.indexOf("@");
  if (atIndex <= 0 || atIndex !== candidate.lastIndexOf("@") || atIndex === candidate.length - 1) {
    return null;
  }

  return candidate;
}

function buildTaskResultSubject(threadSubject: string | null): string {
  if (!threadSubject || threadSubject === "(no-subject)") {
    return "Task update from Meowbert";
  }

  const cleaned = threadSubject.trim();
  if (!cleaned) {
    return "Task update from Meowbert";
  }

  return `Re: ${cleaned}`.slice(0, 240);
}

function normalizeMessageIdForHeader(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const bracketed = trimmed.match(/<[^>\r\n]+>/);
  if (bracketed && bracketed[0]) {
    return bracketed[0];
  }

  const token = trimmed.split(/\s+/)[0]?.trim();
  if (!token || token.includes("<") || token.includes(">")) {
    return null;
  }

  return `<${token}>`;
}

function buildTransactionalReplyHeaders(input: {
  anchorMessageId: string | null;
}): Array<Record<string, string>> | null {
  const messageId = normalizeMessageIdForHeader(input.anchorMessageId);
  if (!messageId) {
    return null;
  }

  return [
    {
      "In-Reply-To": messageId
    },
    {
      References: messageId
    }
  ];
}

export async function sendEmailResultIfNeeded(
  taskId: string,
  connectorContextId: string | null,
  text: string
): Promise<NotificationDeliveryResult> {
  if (!connectorContextId) {
    return {
      status: "skipped",
      channel: "email",
      detail: "Missing connector context."
    };
  }

  if (!config.email.enabled) {
    return {
      status: "skipped",
      channel: "email",
      detail: "Email is disabled in server config."
    };
  }

  const threadRes = await query<EmailThreadRow>(
    `SELECT ct.id,
            ct.workspace_id,
            ct.external_chat_id,
            ct.external_thread_id
       FROM connector_threads ct
       JOIN connector_bindings cb ON cb.id = ct.binding_id
      WHERE ct.id = $1
        AND cb.type = 'email'`,
    [connectorContextId]
  );

  if ((threadRes.rowCount ?? 0) === 0) {
    return {
      status: "skipped",
      channel: "email",
      detail: "No email connector thread found."
    };
  }

  const thread = threadRes.rows[0];
  const recipientEmail = normalizeEmailAddress(thread.external_chat_id);
  if (!recipientEmail) {
    return {
      status: "failed",
      channel: "email",
      detail: "Email connector thread has an invalid sender address."
    };
  }

  const taskRes = await query<TaskWorkspaceRow>(
    `SELECT workspace_id, environment_id
       FROM tasks
      WHERE id = $1
      LIMIT 1`,
    [taskId]
  );
  if ((taskRes.rowCount ?? 0) === 0) {
    return {
      status: "failed",
      channel: "email",
      detail: "Task was not found while preparing email response."
    };
  }

  const taskRow = taskRes.rows[0];
  const taskUrl = `${config.email.appBaseUrl.replace(/\/$/, "")}/app/${taskRow.workspace_id}/projects/${taskRow.environment_id}/tasks/${taskId}`;
  const subject = buildTaskResultSubject(thread.external_thread_id);

  const latestTaskInboundRes = await query<InboundMessageLinkRow>(
    `SELECT external_message_id
       FROM connector_message_links
      WHERE thread_id = $1
        AND direction = 'inbound'
        AND task_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [thread.id, taskId]
  );
  const latestThreadInboundRes = latestTaskInboundRes.rowCount
    ? latestTaskInboundRes
    : await query<InboundMessageLinkRow>(
        `SELECT external_message_id
           FROM connector_message_links
          WHERE thread_id = $1
            AND direction = 'inbound'
          ORDER BY created_at DESC
          LIMIT 1`,
        [thread.id]
      );
  const threadAnchorMessageId = latestThreadInboundRes.rows[0]?.external_message_id ?? null;
  const transactionalReplyHeaders = buildTransactionalReplyHeaders({
    anchorMessageId: threadAnchorMessageId
  });

  try {
    const inserted = await query<{ id: string }>(
      `INSERT INTO email_outbox (
        message_type,
        template_key,
        recipient_user_id,
        recipient_email,
        subject,
        payload_json,
        campaign_id,
        status,
        max_attempts
      )
      VALUES (
        'task_result',
        'task_result',
        NULL,
        $1,
        $2,
        $3::jsonb,
        NULL,
        'queued',
        $4
      )
      RETURNING id`,
      [
        recipientEmail,
        subject,
        JSON.stringify({
          subject,
          response_text: text,
          task_url: taskUrl,
          ...(transactionalReplyHeaders
            ? {
                _meowbert: {
                  tx_headers: transactionalReplyHeaders
                }
              }
            : {})
        }),
        config.email.queue.maxAttempts
      ]
    );

    const outboxEmailId = inserted.rows[0].id;
    const jobId = buildEmailDeliveryQueueJobId(outboxEmailId);
    await emailQueue.add(
      jobId,
      { outboxEmailId },
      {
        jobId,
        removeOnComplete: 2000,
        removeOnFail: 1000,
        attempts: config.email.queue.maxAttempts,
        backoff: {
          type: "exponential",
          delay: config.email.queue.retryBaseMs
        }
      }
    );

    return {
      status: "sent",
      channel: "email",
      externalMessageId: outboxEmailId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `INSERT INTO task_events (task_id, type, payload_json)
       VALUES ($1, 'error', $2::jsonb)`,
      [taskId, JSON.stringify({ emailError: message })]
    );

    return {
      status: "failed",
      channel: "email",
      detail: message
    };
  }
}
