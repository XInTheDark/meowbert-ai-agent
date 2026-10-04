import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../environments/environment-storage.js", () => ({
  ensureEnvironmentStorageRoot: vi.fn(async (input: { root_path: string }) => input.root_path)
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: vi.fn()
  };
});

import { query, withTransaction } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";
import { cloneTaskIntoFork } from "./task-forks.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  return fsPromises.stat(targetPath).then(() => true).catch(() => false);
}

describe("cloneTaskIntoFork", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedEnsureEnvironmentStorageRoot = vi.mocked(ensureEnvironmentStorageRoot);
  const mockedRandomUUID = vi.mocked(randomUUID);
  const client = {
    query: vi.fn()
  };
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset();
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    mockedEnsureEnvironmentStorageRoot.mockImplementation(async (input: { root_path: string }) => input.root_path);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
    await Promise.all(tempDirs.splice(0).map((dir) => fsPromises.rm(dir, { recursive: true, force: true })));
  });

  it("copies source task files into the fork workspace but skips nested child-task directories", async () => {
    mockedRandomUUID.mockReturnValue("11111111-1111-4111-8111-111111111111");

    const envRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-task-fork-"));
    tempDirs.push(envRoot);
    const sourceTaskRootPath = ".meowbert/task-runs/source-task";
    const sourceTaskDir = path.join(envRoot, sourceTaskRootPath);
    await fsPromises.mkdir(path.join(sourceTaskDir, "inputs"), { recursive: true });
    await fsPromises.mkdir(path.join(sourceTaskDir, "analysis"), { recursive: true });
    await fsPromises.mkdir(path.join(sourceTaskDir, "threads", "thread-task-1"), { recursive: true });
    await fsPromises.mkdir(path.join(sourceTaskDir, "subtasks", "subtask-1"), { recursive: true });
    await fsPromises.writeFile(path.join(sourceTaskDir, "plan.md"), "# plan");
    await fsPromises.writeFile(path.join(sourceTaskDir, "inputs", "brief.txt"), "brief");
    await fsPromises.writeFile(path.join(sourceTaskDir, "analysis", "result.json"), "{\"ok\":true}");
    await fsPromises.writeFile(path.join(sourceTaskDir, "threads", "thread-task-1", "notes.txt"), "thread");
    await fsPromises.writeFile(path.join(sourceTaskDir, "subtasks", "subtask-1", "notes.txt"), "subtask");

    mockedQuery.mockResolvedValueOnce(buildRowsResult([
      {
        title: "Original task",
        task_root_path: sourceTaskRootPath,
        environment_id: "env-1",
        environment_workspace_id: "workspace-1",
        environment_root_path: envRoot
      }
    ]));

    client.query
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([
        {
          id: "source-message-1",
          role: "user",
          content_json: { text: "hello" },
          token_usage_json: null,
          source_ref: null,
          parent_message_id: null,
          edited_from_message_id: null
        }
      ]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "fork-message-1" }]));

    const result = await cloneTaskIntoFork({
      sourceTaskId: "source-task",
      destinationWorkspaceId: "workspace-1",
      destinationEnvironmentId: "env-1",
      userId: "user-1",
      copyTaskFiles: true
    });

    const forkTaskDir = path.join(envRoot, ".meowbert/task-runs/11111111-1111-4111-8111-111111111111");

    expect(result).toEqual({
      taskId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "workspace-1",
      environmentId: "env-1"
    });
    await expect(fsPromises.readFile(path.join(forkTaskDir, "plan.md"), "utf8")).resolves.toBe("# plan");
    await expect(fsPromises.readFile(path.join(forkTaskDir, "inputs", "brief.txt"), "utf8")).resolves.toBe("brief");
    await expect(fsPromises.readFile(path.join(forkTaskDir, "analysis", "result.json"), "utf8")).resolves.toBe("{\"ok\":true}");
    await expect(pathExists(path.join(forkTaskDir, "threads"))).resolves.toBe(false);
    await expect(pathExists(path.join(forkTaskDir, "subtasks"))).resolves.toBe(false);

    expect(mockedEnsureEnvironmentStorageRoot).toHaveBeenCalledWith({
      id: "env-1",
      workspace_id: "workspace-1",
      root_path: envRoot
    });
  });

  it("leaves public/share-style forks message-only when task file copying is disabled", async () => {
    mockedRandomUUID.mockReturnValue("22222222-2222-4222-8222-222222222222");

    const envRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-task-fork-public-"));
    tempDirs.push(envRoot);
    const sourceTaskRootPath = ".meowbert/task-runs/source-task";
    const sourceTaskDir = path.join(envRoot, sourceTaskRootPath);
    await fsPromises.mkdir(sourceTaskDir, { recursive: true });
    await fsPromises.writeFile(path.join(sourceTaskDir, "secret.txt"), "keep-local");

    mockedQuery.mockResolvedValueOnce(buildRowsResult([
      {
        title: "Shared task",
        task_root_path: sourceTaskRootPath,
        environment_id: "env-1",
        environment_workspace_id: "workspace-1",
        environment_root_path: envRoot
      }
    ]));

    client.query
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]));

    const result = await cloneTaskIntoFork({
      sourceTaskId: "source-task",
      destinationWorkspaceId: "workspace-2",
      destinationEnvironmentId: "env-2",
      userId: "user-2",
      copyTaskFiles: false
    });

    expect(result).toEqual({
      taskId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "workspace-2",
      environmentId: "env-2"
    });
    await expect(pathExists(path.join(envRoot, ".meowbert/task-runs/22222222-2222-4222-8222-222222222222"))).resolves.toBe(false);
    expect(mockedEnsureEnvironmentStorageRoot).not.toHaveBeenCalled();
  });

  it("rolls back the fork task when task file copying fails", async () => {
    mockedRandomUUID.mockReturnValue("33333333-3333-4333-8333-333333333333");

    const envRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-task-fork-broken-"));
    tempDirs.push(envRoot);

    mockedQuery
      .mockResolvedValueOnce(buildRowsResult([
        {
          title: "Broken task",
          task_root_path: "../escape",
          environment_id: "env-1",
          environment_workspace_id: "workspace-1",
          environment_root_path: envRoot
        }
      ]))
      .mockResolvedValueOnce(buildRowsResult([]));

    client.query
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]));

    await expect(
      cloneTaskIntoFork({
        sourceTaskId: "source-task",
        destinationWorkspaceId: "workspace-1",
        destinationEnvironmentId: "env-1",
        userId: "user-1",
        copyTaskFiles: true
      })
    ).rejects.toThrow("Failed to clone task environment files.");

    expect(mockedQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("DELETE FROM tasks"),
      ["33333333-3333-4333-8333-333333333333"]
    );
  });
});
