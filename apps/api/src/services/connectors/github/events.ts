import {
  GITHUB_THREAD_CONTEXT_HEADING,
  type GitHubInboundComment,
  type GitHubIssueCommentPayload,
  type GitHubPullRequestReviewCommentPayload,
  normalizeGitHubLogin,
  normalizeGitHubOptionalText,
  normalizeGitHubUserId,
  normalizeIsoTimestamp,
  truncateText
} from "./shared.js";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function commentMentionsLogin(commentBody: string, login: string): boolean {
  const pattern = new RegExp(`(^|[^A-Za-z0-9-])@${escapeRegex(login)}(?:\\[bot\\])?\\b`, "i");
  return pattern.test(commentBody);
}

function parseIssueCommentEvent(payload: unknown): GitHubInboundComment | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const parsed = payload as GitHubIssueCommentPayload;
  const repositoryFullName = normalizeGitHubOptionalText(parsed.repository?.full_name);
  const issueNumberRaw = parsed.issue?.number;
  const issueNumber =
    typeof issueNumberRaw === "number" && Number.isInteger(issueNumberRaw) && issueNumberRaw > 0
      ? issueNumberRaw
      : null;
  const commentId = normalizeGitHubUserId(parsed.comment?.id);
  const authorId = normalizeGitHubUserId(parsed.comment?.user?.id ?? parsed.sender?.id);

  if (!repositoryFullName || !issueNumber || !commentId || !authorId) {
    return null;
  }

  const pullRequestUrl = normalizeGitHubOptionalText(parsed.issue?.pull_request?.html_url);
  return {
    eventName: "issue_comment",
    action: normalizeGitHubOptionalText(parsed.action) ?? "",
    repositoryFullName,
    repositoryHtmlUrl: normalizeGitHubOptionalText(parsed.repository?.html_url),
    issueNumber,
    issueTitle: normalizeGitHubOptionalText(parsed.issue?.title),
    issueBody: normalizeGitHubOptionalText(parsed.issue?.body),
    issueHtmlUrl: normalizeGitHubOptionalText(parsed.issue?.html_url),
    pullRequestNumber: pullRequestUrl ? issueNumber : null,
    pullRequestTitle: pullRequestUrl ? normalizeGitHubOptionalText(parsed.issue?.title) : null,
    pullRequestBody: pullRequestUrl ? normalizeGitHubOptionalText(parsed.issue?.body) : null,
    pullRequestHtmlUrl: pullRequestUrl,
    commentId,
    replyToCommentId: null,
    commentBody: normalizeGitHubOptionalText(parsed.comment?.body) ?? "",
    commentHtmlUrl: normalizeGitHubOptionalText(parsed.comment?.html_url),
    commentCreatedAt: normalizeIsoTimestamp(parsed.comment?.created_at),
    authorId,
    authorLogin:
      normalizeGitHubLogin(parsed.comment?.user?.login) ?? normalizeGitHubLogin(parsed.sender?.login)
  };
}

function parsePullRequestReviewCommentEvent(payload: unknown): GitHubInboundComment | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const parsed = payload as GitHubPullRequestReviewCommentPayload;
  const repositoryFullName = normalizeGitHubOptionalText(parsed.repository?.full_name);
  const prNumberRaw = parsed.pull_request?.number;
  const pullRequestNumber =
    typeof prNumberRaw === "number" && Number.isInteger(prNumberRaw) && prNumberRaw > 0
      ? prNumberRaw
      : null;
  const commentId = normalizeGitHubUserId(parsed.comment?.id);
  const authorId = normalizeGitHubUserId(parsed.comment?.user?.id ?? parsed.sender?.id);

  if (!repositoryFullName || !pullRequestNumber || !commentId || !authorId) {
    return null;
  }

  return {
    eventName: "pull_request_review_comment",
    action: normalizeGitHubOptionalText(parsed.action) ?? "",
    repositoryFullName,
    repositoryHtmlUrl: normalizeGitHubOptionalText(parsed.repository?.html_url),
    issueNumber: pullRequestNumber,
    issueTitle: normalizeGitHubOptionalText(parsed.pull_request?.title),
    issueBody: normalizeGitHubOptionalText(parsed.pull_request?.body),
    issueHtmlUrl: normalizeGitHubOptionalText(parsed.pull_request?.html_url),
    pullRequestNumber,
    pullRequestTitle: normalizeGitHubOptionalText(parsed.pull_request?.title),
    pullRequestBody: normalizeGitHubOptionalText(parsed.pull_request?.body),
    pullRequestHtmlUrl: normalizeGitHubOptionalText(parsed.pull_request?.html_url),
    commentId,
    replyToCommentId: normalizeGitHubUserId(parsed.comment?.in_reply_to_id),
    commentBody: normalizeGitHubOptionalText(parsed.comment?.body) ?? "",
    commentHtmlUrl: normalizeGitHubOptionalText(parsed.comment?.html_url),
    commentCreatedAt: normalizeIsoTimestamp(parsed.comment?.created_at),
    authorId,
    authorLogin:
      normalizeGitHubLogin(parsed.comment?.user?.login) ?? normalizeGitHubLogin(parsed.sender?.login)
  };
}

export function parseInboundCommentEvent(eventName: string, payload: unknown): GitHubInboundComment | null {
  if (eventName === "issue_comment") {
    return parseIssueCommentEvent(payload);
  }

  if (eventName === "pull_request_review_comment") {
    return parsePullRequestReviewCommentEvent(payload);
  }

  return null;
}

export function buildThreadId(event: GitHubInboundComment): string {
  if (typeof event.pullRequestNumber === "number") {
    return `pr:${event.pullRequestNumber}`;
  }

  return `issue:${event.issueNumber}`;
}

function buildGitHubUserLabel(event: GitHubInboundComment): string {
  if (event.authorLogin) {
    return `@${event.authorLogin} (id:${event.authorId})`;
  }

  return `id:${event.authorId}`;
}

function buildContextLabel(event: GitHubInboundComment): string {
  if (typeof event.pullRequestNumber === "number") {
    const title = event.pullRequestTitle ?? event.issueTitle;
    return title
      ? `pull_request #${event.pullRequestNumber}: ${title}`
      : `pull_request #${event.pullRequestNumber}`;
  }

  return event.issueTitle
    ? `issue #${event.issueNumber}: ${event.issueTitle}`
    : `issue #${event.issueNumber}`;
}

export function buildGitHubMessageWithMetadata(input: {
  text: string;
  event: GitHubInboundComment;
}): string {
  const body = input.text.trim().length > 0 ? input.text.trim() : "[No text content]";
  const receivedAt = input.event.commentCreatedAt ?? new Date().toISOString();
  const repositoryLabel = input.event.repositoryFullName;
  const contextLabel = buildContextLabel(input.event);
  const issueBodySnippet = truncateText(input.event.issueBody, 1200);
  const pullRequestBodySnippet =
    typeof input.event.pullRequestNumber === "number"
      ? truncateText(input.event.pullRequestBody, 1200)
      : null;

  const lines = [
    "Connector metadata:",
    "- Source: GitHub",
    `- User: ${buildGitHubUserLabel(input.event)}`,
    `- Time: ${receivedAt}`,
    `- Repository: ${repositoryLabel}`,
    `- Context: ${contextLabel}`,
    `- Event: ${input.event.eventName}.${input.event.action || "unknown"}`,
    `- Issue/PR URL: ${input.event.pullRequestHtmlUrl ?? input.event.issueHtmlUrl ?? "(unavailable)"}`,
    `- Comment URL: ${input.event.commentHtmlUrl ?? "(unavailable)"}`,
    "",
    "Message:",
    body
  ];

  if (pullRequestBodySnippet) {
    lines.push("", "Pull request body excerpt:", pullRequestBodySnippet);
  } else if (issueBodySnippet) {
    lines.push("", "Issue body excerpt:", issueBodySnippet);
  }

  return lines.join("\n");
}

export function injectGitHubThreadHistoryIntoMessage(messageText: string, threadHistory: string | null): string {
  if (!threadHistory) {
    return messageText;
  }

  return [messageText, "", GITHUB_THREAD_CONTEXT_HEADING, threadHistory].join("\n");
}

export function pairingAttemptMessage(outcome: string | undefined): string {
  if (outcome === "paired") {
    return "Pairing complete. You can now trigger tasks from this GitHub account.";
  }
  if (outcome === "expired") {
    return "That pairing code expired. Generate a new one from the Connectors page.";
  }
  if (outcome === "already_used") {
    return "That pairing code was already used. Generate a new one if needed.";
  }
  if (outcome === "already_linked") {
    return "This GitHub account is already paired with another Meowbert user.";
  }

  return "Pairing code not recognized. Generate a fresh code from the Connectors page.";
}
