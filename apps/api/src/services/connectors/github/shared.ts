import { normalizeConnectorAgentId } from "../connector-agent.js";

export interface GitHubBindingConfig {
  mentionLogin: string | null;
  defaultEnvironmentId: string | null;
  agentId: string | null;
  tools: unknown;
}

export interface GitHubApiIssueComment {
  id?: number;
  body?: string;
  created_at?: string;
  user?: {
    id?: number;
    login?: string;
  };
}

export interface GitHubApiReviewComment {
  id?: number;
  body?: string;
  created_at?: string;
  user?: {
    id?: number;
    login?: string;
  };
}

export interface GitHubCreateCommentResponse {
  id?: number;
  message?: string;
}

export interface GitHubThreadHistoryEntry {
  commentId: string;
  source: "issue_comment" | "pull_request_review_comment";
  createdAt: string;
  sortTimestampMs: number;
  authorLabel: string;
  body: string;
}

export interface GitHubIssueCommentPayload {
  action?: string;
  repository?: {
    full_name?: string;
    html_url?: string;
  };
  issue?: {
    number?: number;
    title?: string;
    body?: string;
    html_url?: string;
    pull_request?: {
      html_url?: string;
    };
  };
  comment?: {
    id?: number;
    body?: string;
    html_url?: string;
    created_at?: string;
    user?: {
      id?: number;
      login?: string;
    };
  };
  sender?: {
    id?: number;
    login?: string;
  };
}

export interface GitHubPullRequestReviewCommentPayload {
  action?: string;
  repository?: {
    full_name?: string;
    html_url?: string;
  };
  pull_request?: {
    number?: number;
    title?: string;
    body?: string;
    html_url?: string;
  };
  comment?: {
    id?: number;
    body?: string;
    html_url?: string;
    created_at?: string;
    in_reply_to_id?: number;
    user?: {
      id?: number;
      login?: string;
    };
  };
  sender?: {
    id?: number;
    login?: string;
  };
}

export interface GitHubInboundComment {
  eventName: "issue_comment" | "pull_request_review_comment";
  action: string;
  repositoryFullName: string;
  repositoryHtmlUrl: string | null;
  issueNumber: number;
  issueTitle: string | null;
  issueBody: string | null;
  issueHtmlUrl: string | null;
  pullRequestNumber: number | null;
  pullRequestTitle: string | null;
  pullRequestBody: string | null;
  pullRequestHtmlUrl: string | null;
  commentId: string;
  replyToCommentId: string | null;
  commentBody: string;
  commentHtmlUrl: string | null;
  commentCreatedAt: string | null;
  authorId: string;
  authorLogin: string | null;
}

export const GITHUB_THREAD_CONTEXT_HEADING = "Additional GitHub thread context:";

export function normalizeGitHubLogin(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/^@+/, "")
    .replace(/\[bot\]$/i, "")
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function normalizeGitHubUserId(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return String(value);
}

export function normalizeGitHubOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeBindingConfig(configJson: Record<string, unknown>): GitHubBindingConfig {
  const mentionLogin = normalizeGitHubLogin(configJson.mentionLogin);
  const defaultEnvironmentId =
    typeof configJson.defaultEnvironmentId === "string" &&
    configJson.defaultEnvironmentId.trim().length > 0
      ? configJson.defaultEnvironmentId.trim()
      : null;

  return {
    mentionLogin,
    defaultEnvironmentId,
    agentId: normalizeConnectorAgentId(configJson.agentId),
    tools: configJson.tools
  };
}

export function normalizeIsoTimestamp(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncateWithEllipsis(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }

  if (maxChars === 1) {
    return "…";
  }

  return `${text.slice(0, maxChars - 1)}…`;
}

export function normalizeHistoryTimestamp(rawTimestamp: string): string {
  const parsed = new Date(rawTimestamp);
  return Number.isNaN(parsed.getTime()) ? rawTimestamp : parsed.toISOString();
}

export function parseRepositoryFullName(fullName: string): { owner: string; repo: string } | null {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo
  };
}

export function truncateText(text: string | null, maxLength: number): string | null {
  if (!text) {
    return null;
  }

  const compact = text.trim();
  if (compact.length === 0) {
    return null;
  }

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1)}…`;
}
