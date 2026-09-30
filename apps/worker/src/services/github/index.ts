import { query } from "../../lib/db.js";
import { mintGitHubInstallationAuthForWorkspace } from "./workspace-github-app.js";

const GITHUB_MAX_COMMENT_LENGTH = 60_000;

interface GitHubSendResponse {
  id?: number;
  message?: string;
}

interface PendingStatusCommentRow {
  created_id: string | null;
  deleted_id: string | null;
}

export interface NotificationDeliveryResult {
  status: "sent" | "skipped" | "failed";
  channel: "github";
  detail?: string;
  externalMessageId?: string | null;
}

function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function parseThreadIssueNumber(externalThreadId: string | null): number | null {
  if (!externalThreadId) {
    return null;
  }

  const match = externalThreadId.match(/^(?:issue|pr):(\d+)$/);
  if (!match) {
    return null;
  }

  const issueNumber = Number.parseInt(match[1], 10);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return null;
  }

  return issueNumber;
}

async function upsertConnectorMessageLink(input: {
  threadId: string;
  externalMessageId: string;
  taskId: string;
}): Promise<void> {
  await query(
    `INSERT INTO connector_message_links (thread_id, external_message_id, direction, task_id)
     VALUES ($1, $2, 'outbound', $3)
     ON CONFLICT (thread_id, external_message_id)
     DO UPDATE SET
       direction = EXCLUDED.direction,
       task_id = EXCLUDED.task_id`,
    [input.threadId, input.externalMessageId, input.taskId]
  );
}

async function findPendingCreatedStatusCommentId(taskId: string): Promise<string | null> {
  const result = await query<PendingStatusCommentRow>(
    `SELECT (
        SELECT payload_json->>'githubCreatedStatusCommentId'
          FROM task_events
         WHERE task_id = $1
           AND payload_json ? 'githubCreatedStatusCommentId'
         ORDER BY created_at DESC
         LIMIT 1
      ) AS created_id,
      (
        SELECT payload_json->>'githubCreatedStatusCommentDeletedId'
          FROM task_events
         WHERE task_id = $1
           AND payload_json ? 'githubCreatedStatusCommentDeletedId'
         ORDER BY created_at DESC
         LIMIT 1
      ) AS deleted_id`,
    [taskId]
  );

  const row = result.rows[0];
  if (!row?.created_id) {
    return null;
  }

  return row.created_id === row.deleted_id ? null : row.created_id;
}

async function deleteGitHubComment(input: {
  owner: string;
  repo: string;
  commentId: string;
  accessToken: string;
}): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/comments/${encodeURIComponent(input.commentId)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "meowbert-worker"
      }
    }
  );

  if (response.ok || response.status === 404) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  const githubResponse = parsed as GitHubSendResponse | null;
  throw new Error(
    githubResponse && typeof githubResponse.message === "string"
      ? githubResponse.message
      : `GitHub delete comment failed with HTTP ${response.status}`
  );
}

export async function sendGitHubResultIfNeeded(
  taskId: string,
  connectorContextId: string | null,
  text: string
): Promise<NotificationDeliveryResult> {
  if (!connectorContextId) {
    return {
      status: "skipped",
      channel: "github",
      detail: "Missing connector context."
    };
  }

  const threadRes = await query<{
    id: string;
    workspace_id: string;
    external_chat_id: string;
    external_thread_id: string | null;
  }>(
    `SELECT ct.id,
            ct.workspace_id,
            ct.external_chat_id,
            ct.external_thread_id
       FROM connector_threads ct
       JOIN connector_bindings cb ON cb.id = ct.binding_id
      WHERE ct.id = $1
        AND cb.type = 'github'`,
    [connectorContextId]
  );

  if ((threadRes.rowCount ?? 0) === 0) {
    return {
      status: "skipped",
      channel: "github",
      detail: "No GitHub connector thread found."
    };
  }

  const thread = threadRes.rows[0];
  const issueNumber = parseThreadIssueNumber(thread.external_thread_id);
  if (!issueNumber) {
    return {
      status: "failed",
      channel: "github",
      detail: "GitHub thread is missing a valid issue/PR context id."
    };
  }

  const [owner, repo] = thread.external_chat_id.split("/");
  if (!owner || !repo) {
    return {
      status: "failed",
      channel: "github",
      detail: "GitHub thread has an invalid repository identifier."
    };
  }

  const githubAuth = await mintGitHubInstallationAuthForWorkspace({
    workspaceId: thread.workspace_id
  });
  if (!githubAuth) {
    return {
      status: "failed",
      channel: "github",
      detail: "No installed GitHub App token is available for this workspace."
    };
  }

  const chunks = splitTextIntoChunks(text, GITHUB_MAX_COMMENT_LENGTH);
  const pendingCreatedStatusCommentId = await findPendingCreatedStatusCommentId(taskId);
  let lastOutboundMessageId: string | null = null;

  try {
    for (const chunk of chunks) {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${githubAuth.accessToken}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "user-agent": "meowbert-worker"
          },
          body: JSON.stringify({ body: chunk })
        }
      );

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new Error("GitHub create comment returned invalid JSON");
      }

      if (!response.ok) {
        const githubResponse = parsed as GitHubSendResponse | null;
        throw new Error(
          githubResponse && typeof githubResponse.message === "string"
            ? githubResponse.message
            : `GitHub create comment failed with HTTP ${response.status}`
        );
      }

      const githubResponse = parsed as GitHubSendResponse;
      if (typeof githubResponse.id === "number" && Number.isInteger(githubResponse.id)) {
        lastOutboundMessageId = String(githubResponse.id);
      }
    }

    if (!lastOutboundMessageId) {
      return {
        status: "failed",
        channel: "github",
        detail: "GitHub accepted comment without returning a comment id."
      };
    }

    await upsertConnectorMessageLink({
      threadId: thread.id,
      externalMessageId: lastOutboundMessageId,
      taskId
    });

    if (pendingCreatedStatusCommentId) {
      await deleteGitHubComment({
        owner,
        repo,
        commentId: pendingCreatedStatusCommentId,
        accessToken: githubAuth.accessToken
      });
      await query(
        `INSERT INTO task_events (task_id, type, payload_json)
         VALUES ($1, 'log', $2::jsonb)`,
        [
          taskId,
          JSON.stringify({
            githubCreatedStatusCommentDeletedId: pendingCreatedStatusCommentId
          })
        ]
      );
    }

    return {
      status: "sent",
      channel: "github",
      externalMessageId: lastOutboundMessageId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `INSERT INTO task_events (task_id, type, payload_json)
       VALUES ($1, 'error', $2::jsonb)`,
      [taskId, JSON.stringify({ githubError: message })]
    );
    return {
      status: "failed",
      channel: "github",
      detail: message
    };
  }
}
