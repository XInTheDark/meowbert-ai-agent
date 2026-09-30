import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), runtime: vi.fn(), stop: vi.fn() }));
vi.mock("../../lib/db.js", () => ({
  query: mocks.query,
  withConnection: (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }),
  withTransaction: vi.fn()
}));
vi.mock("./persistent-shell-transport.js", () => ({ callPersistentShellRuntime: mocks.runtime }));
vi.mock("./sandbox.js", () => ({ workerSandboxManager: { stopAndRemoveContainer: mocks.stop } }));

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
