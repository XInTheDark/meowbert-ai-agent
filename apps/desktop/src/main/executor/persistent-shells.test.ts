import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MachineSpec } from "@meowbert/run-executor/agent/ports/machine-host";
const runtime = vi.hoisted(() => vi.fn());
vi.mock("@meowbert/shared", async (original) => ({ ...await original<object>(), requestPersistentShellRuntime: runtime }));
import { createLocalPersistentShells } from "./persistent-shells";
let root: string;
let abort: AbortController;
let shells: ReturnType<typeof createLocalPersistentShells>;
let state: { status: string; mode: string; commandId: string | null; command: string; exitCode: number | null; cwd: string; outputTruncated: boolean };
let logPath: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-local-shell-"));
  abort = new AbortController();
  state = { status: "idle", mode: "pipe", commandId: null, command: "", exitCode: null, cwd: root, outputTruncated: false };
  runtime.mockReset().mockImplementation(async (_manager, _session, request, action) => {
    if (action === "launch") { logPath = request.logPath; await fs.writeFile(logPath, "hello\n"); }
    if (request.action === "submit") state = { ...state, status: "running", commandId: "command", command: request.command };
    if (request.action === "stop") state = { ...state, status: "completed", exitCode: -9 };
    return { ...state, bytesAccepted: 5, complete: true };
  });
  shells = createLocalPersistentShells({ signal: abort.signal, machine: { sandbox: { id: "run-container" } } as never,
    spec: { taskId: "task", runId: "run", workspaceId: "workspace", environmentId: "project", actorUserId: "user",
      taskDir: root, taskScratchDir: root, envRoot: root, workspaceRoot: root, readOnly: false, skillsRootDir: null,
      networkEnabled: false, runAsRoot: false, startEagerly: true, log: vi.fn(), env: { TASK_DIR: root },
      resources: { cpus: 2, pids: 256, memoryMb: 2048 } } as MachineSpec });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const start = () => shells.persistentShell({ action: "start", mode: "pipe", envOverrides: { TOKEN: "scoped" } });
it("uses the run container for commands, input, output and waits", async () => {
  const created = await start(); const sessionId = String(created.session_id);
  expect(runtime.mock.calls[0][1]).toMatchObject({ container_id: "run-container", working_dir: root });
  expect(runtime.mock.calls[0][2]).toMatchObject({ env: { TASK_DIR: root, TOKEN: "scoped" }, expiresAt: expect.any(Number) });
  expect(await shells.persistentShell({ action: "run", sessionId, command: "cat", force: false, envOverrides: {} })).toMatchObject({ status: "running", background: true, command_id: "command" });
  expect(await shells.persistentShell({ action: "control", sessionId, control: "input", data: "hello" })).toMatchObject({ bytesAccepted: 5, complete: true });
  expect(runtime.mock.lastCall?.[2]).toMatchObject({ action: "input", commandId: "command", data: "hello" });
  const wait = await shells.readShellSessionWaitState({ sessionId });
  expect(wait).toMatchObject({ status: "running", commandId: "command", output: "hello", outputVersion: expect.any(String) });
  await shells.persistentShell({ action: "status", sessionId, saveOutputPath: "output/shell.txt" });
  expect(await fs.readFile(path.join(root, "output/shell.txt"), "utf8")).toBe("hello\n");
  expect(await shells.persistentShell({ action: "stop", sessionId })).toEqual({ status: "stopped" });
  expect(await shells.readShellSessionWaitState({ sessionId })).toMatchObject({ status: "stopped", stopReason: "Stopped by shell_session." });
});
it("rejects another run's sessions and all tools after fencing", async () => {
  await expect(shells.persistentShell({ action: "status", sessionId: "other-run" })).rejects.toThrow(/does not belong/);
  const created = await start();
  abort.abort(); const calls = runtime.mock.calls.length;
  await expect(shells.persistentShell({ action: "run", sessionId: String(created.session_id), command: "touch unsafe", force: false, envOverrides: {} })).rejects.toThrow();
  await expect(shells.readShellSessionWaitState({ sessionId: String(created.session_id) })).rejects.toThrow();
  expect(runtime).toHaveBeenCalledTimes(calls);
});
it("rejects busy commands and output paths outside the task", async () => {
  const created = await start(); const sessionId = String(created.session_id);
  await shells.persistentShell({ action: "run", sessionId, command: "cat", force: false, envOverrides: {} });
  await expect(shells.persistentShell({ action: "run", sessionId, command: "duplicate", force: false, envOverrides: {} })).rejects.toThrow(/not idle/);
  await expect(shells.persistentShell({ action: "status", sessionId, saveOutputPath: "../escape.txt" })).rejects.toThrow(/stay inside/);
  await fs.symlink(path.dirname(root), path.join(root, "outside"));
  await expect(shells.persistentShell({ action: "status", sessionId, saveOutputPath: "outside/escape.txt" })).rejects.toThrow(/stay inside/);
});
it("keeps completed sessions inspectable and preserves output version changes", async () => {
  const created = await start(); const sessionId = String(created.session_id);
  const first = await shells.readShellSessionWaitState({ sessionId });
  await fs.appendFile(logPath, "next\n");
  state = { ...state, status: "completed", exitCode: 7 };
  const completed = await shells.readShellSessionWaitState({ sessionId });
  expect(completed).toMatchObject({ status: "completed", exitCode: 7, output: "hello\nnext" });
  expect(completed.outputVersion).not.toBe(first.outputVersion);
});
