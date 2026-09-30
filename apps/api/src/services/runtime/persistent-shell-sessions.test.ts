import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("./sandbox.js", () => ({
  apiSandboxManager: {
    stopAndRemoveContainer: vi.fn(),
    attachPersistentSandbox: vi.fn()
  }
}));

import { query, withTransaction } from "../../lib/db.js";
import { apiSandboxManager } from "./sandbox.js";
import {
  listPersistentShellSessions,
  terminatePersistentShellSessions
} from "./persistent-shell-sessions.js";

function createQueryResult<T extends object>(rows: T[]): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}

describe("persistent shell session listing", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedApiSandboxManager = vi.mocked(apiSandboxManager);
  const tempRoots: string[] = [];

  beforeEach(() => mockedQuery.mockReset());
  beforeEach(() => {
    mockedWithTransaction.mockReset();
    mockedApiSandboxManager.stopAndRemoveContainer.mockReset();
  });

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("lists all sessions created by a task, including completed sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-api-shells-"));
    tempRoots.push(root);
    const startedAt = new Date("2026-09-03T10:00:00.000Z");
    const updatedAt = new Date("2026-09-03T10:05:00.000Z");
    const expiresAt = new Date("2026-09-03T22:00:00.000Z");
    mockedQuery.mockResolvedValueOnce(createQueryResult([{
      id: "shell-1",
      status: "completed",
      command: "npm run dev",
      working_dir: "/workspace",
      log_path: path.join(root, "shell.log"),
      started_at: startedAt,
      updated_at: updatedAt,
      container_id: null, mode: "terminal", command_id: null, command_exit_code: 0, current_dir: "/workspace", output_truncated: false,
      lifetime_seconds: 43200,
      expires_at: expiresAt
    }]));
    await fs.writeFile(path.join(root, "shell.log"), "server stopped\n", "utf8");

    await expect(listPersistentShellSessions({
      taskId: "task-1",
      includeOutput: true
    })).resolves.toEqual([{
      id: "shell-1",
      status: "completed",
      command: "npm run dev",
      workingDir: "/workspace",
      startedAt: startedAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      output: "server stopped",
      mode: "terminal", commandId: null, exitCode: 0, outputTruncated: false,
      lifetimeSeconds: 43200,
      expiresAt: expiresAt.toISOString()
    }]);

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE created_by_task_id = $1"),
      ["task-1"]
    );
  });

  it("keeps project listing limited to active sessions", async () => {
    mockedQuery.mockResolvedValueOnce(createQueryResult([]));

    await expect(listPersistentShellSessions({ environmentId: "project-1" })).resolves.toEqual([]);

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE environment_id = $1 AND status IN ('starting', 'running', 'idle')"),
      ["project-1"]
    );
  });

  it("marks active task sessions stopped and removes their containers", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce(createQueryResult([{ id: "shell-1" }]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([{ id: "shell-1", container_id: "container-1" }]))
      .mockResolvedValueOnce(createQueryResult([]));
    mockedWithTransaction.mockImplementation(async (callback) => callback({ query: clientQuery } as never));

    await expect(terminatePersistentShellSessions({
      taskId: "task-1"
    })).resolves.toBe(1);

    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE created_by_task_id = $1"),
      ["task-1"]
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("SET status = 'stopped'"),
      [["shell-1"], "Terminated from the shell monitor."]
    );
    expect(clientQuery).toHaveBeenNthCalledWith(2, "SELECT pg_advisory_xact_lock(hashtext($1))", ["shell-1"]);
    expect(clientQuery).toHaveBeenNthCalledWith(3, expect.stringContaining("id = ANY($2::uuid[])"), ["task-1", ["shell-1"]]);
    expect(mockedApiSandboxManager.stopAndRemoveContainer).toHaveBeenCalledWith("container-1");
  });
});
