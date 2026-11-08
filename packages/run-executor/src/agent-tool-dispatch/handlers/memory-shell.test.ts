import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleRunShell } from "./shell.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { executeShellCommand } from "../../runtime/shell.js";

vi.mock("../../runtime/shell.js", () => ({ executeShellCommand: vi.fn() }));
let workspaceRoot: string;
beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "memory-shell-"));
  vi.clearAllMocks();
  vi.mocked(executeShellCommand).mockResolvedValue({ command: "edit", stdout: "", stderr: "", exitCode: 0, timedOut: false, aborted: false });
});
afterEach(async () => { await fs.rm(workspaceRoot, { recursive: true, force: true }); });

function fixture(memoryEnabled = true, readOnly = false) {
  const ctx = { workspaceRoot, memoryEnabled, readOnly, taskDir: workspaceRoot, taskScratchDir: workspaceRoot,
    assertNotCancelled: vi.fn(), shellToolMaxTimeoutMs: 10_000,
    settings: { shell: "/bin/bash", commandTimeoutMs: 1_000, maxCommandOutputKb: 20 },
    control: { emitEvent: vi.fn(), consumeCommandInterrupt: vi.fn(async () => false), appendMessage: vi.fn(async () => "message"), selectBranch: vi.fn() },
    getCurrentLeafMessageId: () => null, setCurrentLeafMessageId: vi.fn(), shellEnvOverrides: {} } as unknown as ToolDispatchContext;
  const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };
  return { ctx, state };
}
const call = (extra = {}) => ({ type: "function_call" as const, name: "run_shell", call_id: "shell", arguments: JSON.stringify({ command: "edit", memory_write: true, ...extra }) });

describe("coordinated Memory shell commands", () => {
  it("holds the shared lock while the direct shell edit runs, then releases it", async () => {
    const { ctx, state } = fixture();
    vi.mocked(executeShellCommand).mockImplementationOnce(async (input) => {
      expect((await fs.stat(path.join(workspaceRoot, ".memory.write.lock"))).isDirectory()).toBe(true);
      await fs.writeFile(path.join(workspaceRoot, ".memory/note.md"), "shell edit");
      return { command: input.command, stdout: "saved", stderr: "", exitCode: 0, timedOut: false, aborted: false };
    });
    expect((await handleRunShell(call(), ctx, state)).output).toMatchObject({ stdout: "saved", exitCode: 0 });
    expect(await fs.readFile(path.join(workspaceRoot, ".memory/note.md"), "utf8")).toBe("shell edit");
    await expect(fs.stat(path.join(workspaceRoot, ".memory.write.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([[false, false], [true, true]])("rejects unavailable Memory mutations (%s, %s)", async (enabled, readOnly) => {
    const { ctx, state } = fixture(enabled, readOnly);
    expect((await handleRunShell(call(), ctx, state)).output).toMatchObject({ error: expect.stringContaining("unavailable") });
    expect(executeShellCommand).not.toHaveBeenCalled();
  });

  it("rejects persistent sessions because their commands outlive the lock", async () => {
    const { ctx, state } = fixture();
    const result = await handleRunShell(call({ session_id: "10000000-0000-4000-8000-000000000001" }), ctx, state);
    expect(result.output).toMatchObject({ error: expect.stringContaining("foreground") });
    expect(executeShellCommand).not.toHaveBeenCalled();
  });

  it("continues to allow ordinary direct shell commands without coordination", async () => {
    const { ctx, state } = fixture();
    expect((await handleRunShell(call({ memory_write: false }), ctx, state)).output).toMatchObject({ exitCode: 0 });
    expect(executeShellCommand).toHaveBeenCalledOnce();
    expect(await fs.readdir(workspaceRoot)).toEqual([]);
  });
});
