import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
}));

vi.mock("../environments/environment-memory.js", () => ({
  isEnvironmentMemoryEnabled: vi.fn(async () => false)
}));

vi.mock("../project-master/master-task.js", () => {
  class ProjectMasterError extends Error {
    constructor(message: string, readonly statusCode: number) {
      super(message);
    }
  }
  return {
    ProjectMasterError,
    isProjectMasterEnabledForWorkspace: vi.fn(),
    getProjectMasterTaskId: vi.fn(),
    ensureProjectMasterTask: vi.fn()
  };
});

vi.mock("../tasks/task-history.js", () => ({
  ensureTaskHistoryWarm: vi.fn(async () => undefined)
}));

vi.mock("../tasks/task-service/index.js", () => ({
  appendTaskUserMessageAndEnqueue: vi.fn()
}));

vi.mock("./connector-routing.js", () => ({
  decideEnvironmentRoute: vi.fn()
}));

vi.mock("./connector-task-context.js", () => ({
  listActiveConnectorEnvironments: vi.fn()
}));

vi.mock("./connector-threads.js", () => ({
  upsertConnectorThreadMessageTaskLink: vi.fn(async () => undefined)
}));

import {
  ensureProjectMasterTask,
  getProjectMasterTaskId,
  isProjectMasterEnabledForWorkspace,
  ProjectMasterError
} from "../project-master/master-task.js";
import { appendTaskUserMessageAndEnqueue } from "../tasks/task-service/index.js";
import { TaskExecutionUserRequiredError } from "../tasks/task-service/prompt-usage.js";
import { decideEnvironmentRoute } from "./connector-routing.js";
import { listActiveConnectorEnvironments } from "./connector-task-context.js";
import { upsertConnectorThreadMessageTaskLink } from "./connector-threads.js";
import { deliverConnectorMessageToMaster, resolveConnectorMasterTarget } from "./connector-master-ingest.js";

const resolveInput = {
  source: "telegram" as const,
  workspaceId: "workspace-1",
  actorUserId: "user-1",
  defaultEnvironmentId: "env-1",
  routingText: "hello"
};

describe("resolveConnectorMasterTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isProjectMasterEnabledForWorkspace).mockResolvedValue(true);
    vi.mocked(listActiveConnectorEnvironments).mockResolvedValue([
      { id: "env-1", name: "Alpha" },
      { id: "env-2", name: "Beta" }
    ]);
    vi.mocked(decideEnvironmentRoute).mockResolvedValue({
      environmentId: "env-1",
      reason: "default_environment",
      confidence: 1,
      selectionSource: "default",
      usedFallback: false
    });
    vi.mocked(getProjectMasterTaskId).mockResolvedValue("master-1");
  });

  it("refuses connector messages when the Project Master is off", async () => {
    vi.mocked(isProjectMasterEnabledForWorkspace).mockResolvedValue(false);

    await expect(resolveConnectorMasterTarget(resolveInput)).rejects.toBeInstanceOf(ProjectMasterError);
    expect(ensureProjectMasterTask).not.toHaveBeenCalled();
  });

  it("requires an accountable user", async () => {
    await expect(resolveConnectorMasterTarget({ ...resolveInput, actorUserId: null }))
      .rejects.toBeInstanceOf(TaskExecutionUserRequiredError);
  });

  it("targets the existing Master of the chosen project", async () => {
    const target = await resolveConnectorMasterTarget(resolveInput);

    expect(target).toMatchObject({ environmentId: "env-1", masterTaskId: "master-1", routingNote: null });
    expect(ensureProjectMasterTask).not.toHaveBeenCalled();
  });

  it("creates the Master on first contact", async () => {
    vi.mocked(getProjectMasterTaskId).mockResolvedValue(null);
    vi.mocked(ensureProjectMasterTask).mockResolvedValue("master-new");

    const target = await resolveConnectorMasterTarget(resolveInput);

    expect(target.masterTaskId).toBe("master-new");
    expect(ensureProjectMasterTask).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: "env-1", workspaceId: "workspace-1", userId: "user-1", timezone: "UTC" })
    );
  });

  it("flags a fallback project pick so the Master can mention it", async () => {
    vi.mocked(decideEnvironmentRoute).mockResolvedValue({
      environmentId: "env-2",
      reason: "fallback:llm_error",
      confidence: 0.1,
      selectionSource: "fallback",
      usedFallback: true
    });

    const target = await resolveConnectorMasterTarget({ ...resolveInput, defaultEnvironmentId: null });

    expect(target.environmentId).toBe("env-2");
    expect(target.routingNote).toContain("Beta");
  });

  it("reports a workspace without projects instead of crashing", async () => {
    vi.mocked(listActiveConnectorEnvironments).mockResolvedValue([]);

    await expect(resolveConnectorMasterTarget(resolveInput)).rejects.toBeInstanceOf(ProjectMasterError);
  });
});

describe("deliverConnectorMessageToMaster", () => {
  const target = {
    source: "telegram" as const,
    workspaceId: "workspace-1",
    environmentId: "env-1",
    masterTaskId: "master-1",
    actorUserId: "user-1",
    routingNote: null
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appendTaskUserMessageAndEnqueue).mockResolvedValue({
      taskId: "master-1",
      mode: "enqueued",
      runId: "run-1",
      attemptNo: 2,
      messageId: "message-1",
      activeLeafMessageId: "message-1"
    });
  });

  it("appends to the Master as the sender and points its replies at the chat", async () => {
    const result = await deliverConnectorMessageToMaster({
      target,
      threadId: "thread-1",
      inboundMessageId: "42",
      message: "how is the migration going?",
      toolsConfig: {},
      agentId: null
    });

    expect(result).toEqual({
      processed: true,
      taskId: "master-1",
      environmentId: "env-1",
      action: "sent_to_master"
    });
    expect(appendTaskUserMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "master-1",
        triggerSource: "telegram",
        userId: "user-1",
        connectorContextId: "thread-1",
        interruptQueued: true
      })
    );
    expect(upsertConnectorThreadMessageTaskLink).toHaveBeenCalledWith({
      threadId: "thread-1",
      externalMessageId: "42",
      direction: "inbound",
      taskId: "master-1"
    });
  });

  it("appends the project routing note to the message the Master reads", async () => {
    await deliverConnectorMessageToMaster({
      target: { ...target, routingNote: "Routing note: fallback." },
      threadId: "thread-1",
      inboundMessageId: null,
      message: "hi",
      toolsConfig: {},
      agentId: null
    });

    expect(appendTaskUserMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ message: "hi\n\nRouting note: fallback." })
    );
    expect(upsertConnectorThreadMessageTaskLink).not.toHaveBeenCalled();
  });
});
