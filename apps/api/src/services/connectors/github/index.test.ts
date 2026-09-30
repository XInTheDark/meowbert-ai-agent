import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../connector-agent.js", () => ({
  normalizeConnectorAgentId: vi.fn(() => null)
}));

vi.mock("../connector-execution-errors.js", () => ({
  describeConnectorExecutionError: vi.fn(() => null)
}));

vi.mock("../connector-pairing.js", () => ({
  consumeConnectorPairCodeIfPresent: vi.fn(async () => ({ handled: false, outcome: "invalid" })),
  resolveConnectorPairedUserId: vi.fn()
}));

vi.mock("../connector-master-ingest.js", () => ({
  resolveConnectorMasterTarget: vi.fn(),
  deliverConnectorMessageToMaster: vi.fn()
}));

vi.mock("../connector-threads.js", () => ({
  connectorThreadHasInboundMessages: vi.fn(async () => true),
  findConnectorThread: vi.fn(),
  getOrCreateConnectorThread: vi.fn(),
  isConnectorThreadMidConversation: vi.fn(),
  resolveConnectorTaskFromExternalMessage: vi.fn(async () => null)
}));

vi.mock("./events.js", () => ({
  buildGitHubMessageWithMetadata: vi.fn(() => "follow-up"),
  buildThreadId: vi.fn(() => "issue-7"),
  commentMentionsLogin: vi.fn(() => false),
  injectGitHubThreadHistoryIntoMessage: vi.fn((message: string) => message),
  pairingAttemptMessage: vi.fn(() => "paired"),
  parseInboundCommentEvent: vi.fn()
}));

vi.mock("./github-api.js", () => ({
  maybeBuildGitHubThreadHistory: vi.fn(async () => null),
  sendGitHubIssueComment: vi.fn(async () => null)
}));

vi.mock("./shared.js", () => ({
  normalizeBindingConfig: vi.fn(() => ({
    mentionLogin: "meowbert",
    defaultEnvironmentId: null,
    agentId: null,
    tools: {}
  })),
  normalizeGitHubLogin: vi.fn((value: string | null | undefined) => value ?? null)
}));

import { query } from "../../../lib/db.js";
import {
  deliverConnectorMessageToMaster,
  resolveConnectorMasterTarget,
  type ConnectorMasterTarget
} from "../connector-master-ingest.js";
import {
  findConnectorThread,
  getOrCreateConnectorThread,
  isConnectorThreadMidConversation
} from "../connector-threads.js";
import { resolveConnectorPairedUserId } from "../connector-pairing.js";
import { parseInboundCommentEvent } from "./events.js";
import type { GitHubInboundComment } from "./shared.js";
import { listGitHubBindingsByInstallationId, processGitHubWebhookForBinding } from "./index.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("listGitHubBindingsByInstallationId", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all bindings for a shared GitHub installation", async () => {
    mockedQuery.mockResolvedValueOnce(
      buildRowsResult([
        {
          id: "binding-2",
          workspace_id: "workspace-2",
          config_json: {},
          status: "active"
        },
        {
          id: "binding-1",
          workspace_id: "workspace-1",
          config_json: {},
          status: "active"
        }
      ])
    );

    await expect(listGitHubBindingsByInstallationId(123)).resolves.toHaveLength(2);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY cb.updated_at DESC"),
      [123]
    );
  });
});

describe("processGitHubWebhookForBinding", () => {
  const target: ConnectorMasterTarget = {
    source: "github",
    workspaceId: "workspace-1",
    environmentId: "environment-1",
    masterTaskId: "master-1",
    actorUserId: "user-1",
    routingNote: null
  };
  const binding = {
    id: "binding-1",
    workspace_id: "workspace-1",
    status: "active",
    config_json: {}
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveConnectorPairedUserId).mockResolvedValue("user-1");
    vi.mocked(findConnectorThread).mockResolvedValue({ id: "thread-1" });
    vi.mocked(getOrCreateConnectorThread).mockResolvedValue({ id: "thread-1" });
    vi.mocked(isConnectorThreadMidConversation).mockResolvedValue(false);
    vi.mocked(resolveConnectorMasterTarget).mockResolvedValue(target);
    vi.mocked(deliverConnectorMessageToMaster).mockResolvedValue({
      processed: true,
      taskId: "master-1",
      environmentId: "environment-1",
      action: "sent_to_master"
    });
    const inboundComment: GitHubInboundComment = {
      action: "created",
      repositoryHtmlUrl: "https://github.com/octo/repo",
      issueTitle: "Issue title",
      issueBody: "Issue body",
      issueHtmlUrl: "https://github.com/octo/repo/issues/7",
      pullRequestTitle: null,
      pullRequestBody: null,
      pullRequestHtmlUrl: null,
      commentId: "comment-1",
      replyToCommentId: null,
      commentBody: "please adjust the current run",
      commentHtmlUrl: "https://github.com/octo/repo/issues/7#issuecomment-1",
      commentCreatedAt: "2026-03-31T08:00:00.000Z",
      authorId: "author-1",
      authorLogin: "alice",
      repositoryFullName: "octo/repo",
      issueNumber: 7,
      pullRequestNumber: null,
      eventName: "issue_comment"
    };
    vi.mocked(parseInboundCommentEvent).mockReturnValue(inboundComment);
  });

  it("sends a follow-up comment to the Master without a fresh mention while it is still working", async () => {
    vi.mocked(isConnectorThreadMidConversation).mockResolvedValue(true);

    const result = await processGitHubWebhookForBinding({ binding, eventName: "issue_comment", payload: {} });

    expect(result).toMatchObject({ processed: true, taskId: "master-1", action: "sent_to_master" });
    expect(findConnectorThread).toHaveBeenCalledWith({
      bindingId: "binding-1",
      externalChatId: "octo/repo",
      externalThreadId: "issue-7"
    });
    expect(resolveConnectorMasterTarget).toHaveBeenCalledWith(
      expect.objectContaining({ source: "github", workspaceId: "workspace-1", actorUserId: "user-1" })
    );
    expect(deliverConnectorMessageToMaster).toHaveBeenCalledWith(
      expect.objectContaining({ target, threadId: "thread-1", inboundMessageId: "comment-1" })
    );
  });

  it("ignores an unmentioned comment when the Master is not mid-conversation", async () => {
    const result = await processGitHubWebhookForBinding({ binding, eventName: "issue_comment", payload: {} });

    expect(result).toEqual({ processed: false });
    expect(deliverConnectorMessageToMaster).not.toHaveBeenCalled();
  });
});
