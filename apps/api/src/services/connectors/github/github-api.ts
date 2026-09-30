import { query } from "../../../lib/db.js";
import { resolveContextWindowTokensForWorkspace } from "../../platform/platform-model-metadata.js";
import { mintGitHubInstallationToken } from "./app-auth.js";
import {
  compactWhitespace,
  type GitHubApiIssueComment,
  type GitHubApiReviewComment,
  type GitHubCreateCommentResponse,
  type GitHubThreadHistoryEntry,
  normalizeGitHubLogin,
  normalizeGitHubUserId,
  normalizeHistoryTimestamp,
  normalizeIsoTimestamp,
  parseRepositoryFullName,
  truncateWithEllipsis
} from "./shared.js";

const DEFAULT_CONTEXT_HISTORY_RATIO = 0.2;
const APPROX_CHARS_PER_TOKEN = 4;
const MIN_GITHUB_THREAD_HISTORY_CHARS = 1_000;
const MAX_GITHUB_THREAD_HISTORY_CHARS = 120_000;
const MAX_GITHUB_THREAD_EVENTS = 80;
const MAX_GITHUB_THREAD_ENTRY_CHARS = 700;

interface WorkspaceGitHubAppAuthRow {
  app_id: string;
  app_slug: string;
  private_key_pem: string;
  installation_id: string | null;
}

function clampGitHubThreadHistoryChars(value: number): number {
  return Math.min(
    MAX_GITHUB_THREAD_HISTORY_CHARS,
    Math.max(MIN_GITHUB_THREAD_HISTORY_CHARS, Math.floor(value))
  );
}

function resolveGitHubThreadHistoryCharBudget(maxContextWindowTokens: number): number {
  const derived =
    maxContextWindowTokens * DEFAULT_CONTEXT_HISTORY_RATIO * APPROX_CHARS_PER_TOKEN;
  return clampGitHubThreadHistoryChars(derived);
}

function formatGitHubThreadHistoryEntry(entry: GitHubThreadHistoryEntry): string {
  const sourceLabel =
    entry.source === "pull_request_review_comment" ? "review comment" : "issue comment";
  const body = entry.body.trim().length > 0 ? entry.body : "[empty comment]";
  const truncatedBody = truncateWithEllipsis(body, MAX_GITHUB_THREAD_ENTRY_CHARS);
  return `[${normalizeHistoryTimestamp(entry.createdAt)}] ${entry.authorLabel} (${sourceLabel}): ${truncatedBody}`;
}

function buildGitHubThreadHistoryContext(input: {
  entries: GitHubThreadHistoryEntry[];
  maxChars: number;
}): string | null {
  if (input.entries.length === 0) {
    return null;
  }

  const sections: string[] = [];
  let usedChars = 0;

  function appendLine(line: string, allowTruncate = false): boolean {
    const separatorChars = sections.length === 0 ? 0 : 1;
    const remaining = input.maxChars - usedChars - separatorChars;
    if (remaining <= 0) {
      return false;
    }

    if (line.length <= remaining) {
      sections.push(line);
      usedChars += separatorChars + line.length;
      return true;
    }

    if (!allowTruncate || remaining < 12) {
      return false;
    }

    sections.push(truncateWithEllipsis(line, remaining));
    usedChars = input.maxChars;
    return false;
  }

  appendLine("Recent GitHub issue/PR thread history:", true);
  for (const entry of input.entries) {
    if (!appendLine(formatGitHubThreadHistoryEntry(entry), true)) {
      break;
    }
  }

  return sections.length > 0 ? sections.join("\n") : null;
}

async function fetchGitHubApiList<T>(input: {
  accessToken: string;
  path: string;
}): Promise<T[] | null> {
  const response = await fetch(`https://api.github.com${input.path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "meowbert-api"
    }
  }).catch(() => null);

  if (!response || !response.ok) {
    return null;
  }

  const parsed = await response.json().catch(() => null);
  return Array.isArray(parsed) ? (parsed as T[]) : null;
}

async function loadWorkspaceGitHubAppAuth(workspaceId: string): Promise<WorkspaceGitHubAppAuthRow | null> {
  const appRes = await query<WorkspaceGitHubAppAuthRow>(
    `SELECT app_id::text,
            app_slug,
            private_key_pem,
            installation_id::text
       FROM workspace_github_apps
      WHERE workspace_id = $1
      LIMIT 1`,
    [workspaceId]
  );

  return appRes.rows[0] ?? null;
}

async function mintWorkspaceGitHubAccessToken(input: {
  workspaceId: string;
}): Promise<{ accessToken: string; appSlug: string } | null> {
  const appConfig = await loadWorkspaceGitHubAppAuth(input.workspaceId);
  if (!appConfig) {
    return null;
  }

  const appId = Number.parseInt(appConfig.app_id, 10);
  const installationId = appConfig.installation_id ? Number.parseInt(appConfig.installation_id, 10) : NaN;
  if (!Number.isInteger(appId) || appId <= 0 || !Number.isInteger(installationId) || installationId <= 0) {
    return null;
  }

  try {
    const token = await mintGitHubInstallationToken({
      appId,
      privateKeyPem: appConfig.private_key_pem,
      installationId
    });
    return {
      accessToken: token.token,
      appSlug: appConfig.app_slug
    };
  } catch {
    return null;
  }
}

export async function maybeBuildGitHubThreadHistory(input: {
  workspaceId: string;
  repositoryFullName: string;
  issueNumber: number;
  pullRequestNumber: number | null;
  currentCommentId: string;
}): Promise<string | null> {
  const repository = parseRepositoryFullName(input.repositoryFullName);
  if (!repository) {
    return null;
  }

  const auth = await mintWorkspaceGitHubAccessToken({ workspaceId: input.workspaceId });
  if (!auth) {
    return null;
  }

  const encodedOwner = encodeURIComponent(repository.owner);
  const encodedRepo = encodeURIComponent(repository.repo);
  const issueCommentsPath =
    `/repos/${encodedOwner}/${encodedRepo}/issues/${input.issueNumber}/comments` +
    `?per_page=${MAX_GITHUB_THREAD_EVENTS}&sort=created&direction=desc`;
  const pullRequestReviewCommentsPath =
    typeof input.pullRequestNumber === "number"
      ? `/repos/${encodedOwner}/${encodedRepo}/pulls/${input.pullRequestNumber}/comments` +
        `?per_page=${MAX_GITHUB_THREAD_EVENTS}&sort=created&direction=desc`
      : null;

  const [issueComments, reviewComments] = await Promise.all([
    fetchGitHubApiList<GitHubApiIssueComment>({
      accessToken: auth.accessToken,
      path: issueCommentsPath
    }),
    pullRequestReviewCommentsPath
      ? fetchGitHubApiList<GitHubApiReviewComment>({
          accessToken: auth.accessToken,
          path: pullRequestReviewCommentsPath
        })
      : Promise.resolve(null)
  ]);

  if (!issueComments && !reviewComments) {
    return null;
  }

  const entries: GitHubThreadHistoryEntry[] = [];
  const seenCommentKeys = new Set<string>();

  function appendEntry(
    source: "issue_comment" | "pull_request_review_comment",
    comment: GitHubApiIssueComment | GitHubApiReviewComment
  ): void {
    const commentId = normalizeGitHubUserId(comment.id);
    if (!commentId || commentId === input.currentCommentId) {
      return;
    }

    const dedupeKey = `${source}:${commentId}`;
    if (seenCommentKeys.has(dedupeKey)) {
      return;
    }

    const bodyText = compactWhitespace(typeof comment.body === "string" ? comment.body : "");
    if (!bodyText) {
      return;
    }

    const createdAtIso = normalizeIsoTimestamp(comment.created_at);
    const createdAtRaw =
      typeof comment.created_at === "string" && comment.created_at.trim().length > 0
        ? comment.created_at
        : "unknown-time";
    const createdAt = createdAtIso ?? createdAtRaw;
    const sortTimestampMs = Date.parse(createdAt);

    const authorLogin = normalizeGitHubLogin(comment.user?.login);
    const authorId = normalizeGitHubUserId(comment.user?.id);
    const authorLabel = authorLogin
      ? `@${authorLogin}`
      : authorId
        ? `id:${authorId}`
        : "unknown-user";

    seenCommentKeys.add(dedupeKey);
    entries.push({
      commentId,
      source,
      createdAt,
      sortTimestampMs: Number.isNaN(sortTimestampMs) ? 0 : sortTimestampMs,
      authorLabel,
      body: bodyText
    });
  }

  for (const comment of issueComments ?? []) {
    appendEntry("issue_comment", comment);
  }
  for (const comment of reviewComments ?? []) {
    appendEntry("pull_request_review_comment", comment);
  }

  if (entries.length === 0) {
    return null;
  }

  const sortedRecentEntries = entries
    .sort((left, right) => {
      if (left.sortTimestampMs === right.sortTimestampMs) {
        return left.commentId.localeCompare(right.commentId);
      }
      return left.sortTimestampMs - right.sortTimestampMs;
    })
    .slice(-MAX_GITHUB_THREAD_EVENTS);
  const maxContextWindowTokens = await resolveContextWindowTokensForWorkspace(input.workspaceId);

  return buildGitHubThreadHistoryContext({
    entries: sortedRecentEntries,
    maxChars: resolveGitHubThreadHistoryCharBudget(maxContextWindowTokens)
  });
}

export async function sendGitHubIssueComment(input: {
  workspaceId: string;
  repositoryFullName: string;
  issueNumber: number;
  text: string;
}): Promise<string | null> {
  if (!input.text.trim()) {
    return null;
  }

  const auth = await mintWorkspaceGitHubAccessToken({ workspaceId: input.workspaceId });
  if (!auth) {
    return null;
  }

  const repository = parseRepositoryFullName(input.repositoryFullName);
  if (!repository) {
    return null;
  }

  const encodedOwner = encodeURIComponent(repository.owner);
  const encodedRepo = encodeURIComponent(repository.repo);
  return fetch(
    `https://api.github.com/repos/${encodedOwner}/${encodedRepo}/issues/${input.issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "meowbert-api"
      },
      body: JSON.stringify({
        body: input.text.slice(0, 60_000)
      })
    }
  )
    .then(async (response) => {
      const parsed = await response.json().catch(() => null) as GitHubCreateCommentResponse | null;
      if (!response.ok) {
        return null;
      }
      return typeof parsed?.id === "number" && Number.isInteger(parsed.id)
        ? String(parsed.id)
        : null;
    })
    .catch(() => {
      // Best effort only; pairing/status notices should not block task ingestion.
      return null;
    });
}
