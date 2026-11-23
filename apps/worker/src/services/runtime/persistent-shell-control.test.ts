import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), runtime: vi.fn(), stop: vi.fn(), crashReport: vi.fn() }));
vi.mock("../../lib/db.js", () => ({
  query: mocks.query,
  withConnection: (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }),
  withTransaction: vi.fn()
}));
vi.mock("./persistent-shell-transport.js", () => ({ callPersistentShellRuntime: mocks.runtime }));
vi.mock("./sandbox.js", () => ({
  workerSandboxManager: { stopAndRemoveContainer: mocks.stop, readCrashReport: mocks.crashReport }
}));

import {
  controlPersistentShellSession,
  listPersistentShellSessions,
  runPersistentShellCommand
} from "./persistent-shell-sessions.js";

const session = {
  id: "session-1", environment_id: "project-1", workspace_id: "workspace-1",
  container_id: "original-container", working_dir: "/project", status: "idle",
  lifetime_seconds: 43200, expires_at: new Date(Date.now() + 43200 * 1000)
};
const context = {
  taskId: "another-task", workspaceId: "workspace-1", environmentId: "project-1",
  creatorUserId: "user-1", taskDir: "/project/task", envRoot: "/project", workspaceRoot: "/workspace",
  workingDir: "/project", networkEnabled: false, runAsRoot: false, shell: "/bin/bash", env: {},
  sessionId: "session-1", command: "pwd", force: false
};
const idle = {
  status: "idle", commandId: "previous-command", command: "cd nested", exitCode: 0,
  cwd: "/project/nested", mode: "terminal", outputTruncated: false
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.crashReport.mockResolvedValue(null);
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("SELECT id, workspace_id") ? [{ ...session }] : [], rowCount: 1
  }));
});

describe("persistent shell command coordination", () => {
  it("submits from a later task to the existing container without replacing its shell", async () => {
    mocks.runtime.mockResolvedValueOnce(idle).mockResolvedValueOnce({ ...idle, status: "running", commandId: "new-command" });
    await expect(runPersistentShellCommand(context)).resolves.toMatchObject({ commandId: "new-command", status: "running" });
    expect(mocks.runtime).toHaveBeenLastCalledWith(expect.objectContaining({ container_id: "original-container" }), { action: "submit", command: "pwd" });
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenNthCalledWith(1, "SELECT pg_advisory_lock(hashtext($1))", ["session-1"]);
    expect(mocks.query).toHaveBeenLastCalledWith("SELECT pg_advisory_unlock(hashtext($1))", ["session-1"]);
  });

  it("rejects a busy command without forcing or sending command text to stdin", async () => {
    mocks.runtime.mockResolvedValueOnce({ ...idle, status: "running" });
    await expect(runPersistentShellCommand(context)).rejects.toThrow("Session is not idle");
    expect(mocks.runtime).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("force interrupts the captured command and waits for idle before submitting", async () => {
    mocks.runtime.mockResolvedValueOnce({ ...idle, status: "running" })
      .mockResolvedValueOnce({ ...idle, status: "running" }).mockResolvedValueOnce(idle)
      .mockResolvedValueOnce({ ...idle, status: "running", commandId: "replacement" });
    await runPersistentShellCommand({ ...context, force: true });
    expect(mocks.runtime).toHaveBeenNthCalledWith(2, expect.anything(), { action: "interrupt", commandId: "previous-command" });
    expect(mocks.runtime).toHaveBeenNthCalledWith(3, expect.anything(), { action: "status" });
    expect(mocks.runtime).toHaveBeenNthCalledWith(4, expect.anything(), { action: "submit", command: "pwd" });
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("binds stdin to the observed command and preserves acknowledgement when metadata sync fails", async () => {
    mocks.runtime.mockResolvedValueOnce({ ...idle, status: "running" })
      .mockResolvedValueOnce({ bytesAccepted: 4, complete: true })
      .mockRejectedValueOnce(new Error("metadata unavailable"));
    await expect(controlPersistentShellSession({
      sessionId: session.id, environmentId: "project-1", action: "input", data: "yes\n"
    })).resolves.toEqual({ bytesAccepted: 4, complete: true, statusSyncPending: true });
    expect(mocks.runtime).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      action: "input", commandId: "previous-command", data: "yes\n"
    }));
  });

  it("does not access a shell in another workspace", async () => {
    await expect(runPersistentShellCommand({ ...context, workspaceId: "other-workspace" })).rejects.toThrow("does not belong");
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it("never restarts a stopped session", async () => {
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT id, workspace_id") ? [{ ...session, status: "stopped" }] : []
    }));
    await expect(runPersistentShellCommand(context)).rejects.toThrow("session has ended");
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it("lists active sessions for an environment and refreshes their state", async () => {
    mocks.runtime.mockResolvedValueOnce(idle);
    const results = await listPersistentShellSessions({ environmentId: "project-1" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "session-1",
      status: "idle",
      workingDir: "/project"
    });
  });

  it("returns an empty array when no active sessions exist", async () => {
    mocks.query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const results = await listPersistentShellSessions({ environmentId: "project-1" });
    expect(results).toEqual([]);
  });

  it("stops and rejects expired persistent shell sessions when submitting commands", async () => {
    const expiredSession = {
      ...session,
      expires_at: new Date(Date.now() - 1000)
    };
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT id, workspace_id") ? [{ ...expiredSession }] : [], rowCount: 1
    }));
    await expect(runPersistentShellCommand(context)).rejects.toThrow("lifetime expired");
    expect(mocks.stop).toHaveBeenCalledWith("original-container");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'stopped'"),
      ["session-1", "Persistent shell session lifetime expired."]
    );
  });

  it("stops and rejects control operations on expired persistent shell sessions", async () => {
    const expiredSession = {
      ...session,
      expires_at: new Date(Date.now() - 1000)
    };
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT id, workspace_id") ? [{ ...expiredSession }] : [], rowCount: 1
    }));
    await expect(controlPersistentShellSession({
      sessionId: session.id,
      environmentId: "project-1",
      action: "input",
      data: "echo hello\n"
    })).rejects.toThrow("Persistent shell session is unavailable.");
    expect(mocks.stop).toHaveBeenCalledWith("original-container");
  });
});

describe("persistent shell status failures", () => {
  const failedUpdates = () => mocks.query.mock.calls.filter(([sql]) => String(sql).includes("status = 'failed'"));
  const useSession = (id: string) => {
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT id, workspace_id") ? [{ ...session, id }] : [], rowCount: 1
    }));
  };

  it("keeps a session whose container is still running when a status request fails", async () => {
    useSession("session-slow");
    mocks.runtime.mockRejectedValue(new Error("Persistent shell request failed. Request timed out."));
    const results = await listPersistentShellSessions({ environmentId: "project-1" });
    expect(results[0]).toMatchObject({ id: "session-slow", status: "idle" });
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(failedUpdates()).toHaveLength(0);
  });

  it("fails the session with Docker's crash report when the container stopped", async () => {
    useSession("session-crashed");
    mocks.runtime.mockRejectedValue(new Error("Persistent sandbox container is not running"));
    mocks.crashReport.mockResolvedValue({
      containerId: "original-container",
      state: { status: "exited", exitCode: 137, oomKilled: true, error: null, startedAt: null, finishedAt: null },
      limits: null,
      recentEvents: ""
    });
    await listPersistentShellSessions({ environmentId: "project-1" });
    expect(mocks.stop).toHaveBeenCalledWith("original-container");
    const [, params] = failedUpdates()[0];
    expect(params[1]).toContain("Persistent runtime container exited");
    expect(params[1]).toContain("\"oomKilled\":true");
  });

  it("stops a running container whose supervisor stays unreachable past the grace period", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    useSession("session-hung");
    mocks.runtime.mockRejectedValue(new Error("Persistent shell request failed. Exit code: 1."));
    await listPersistentShellSessions({ environmentId: "project-1" });
    expect(mocks.stop).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3 * 60_000);
    await listPersistentShellSessions({ environmentId: "project-1" });
    expect(mocks.stop).toHaveBeenCalledWith("original-container");
    const [, params] = failedUpdates()[0];
    expect(params[1]).toContain("stopped responding");
    expect(params[1]).toContain("Exit code: 1.");
  });
});
