import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { createHostPersistentShells } from "./host-persistent-shells";

afterEach(() => { vi.restoreAllMocks(); });

async function setup() {
  const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-host-shell-"));
  let exit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => { exit = resolve; });
  const stdout = new PassThrough();
  const process = { stdout, stderr: new PassThrough(), stdin: new PassThrough(),
    waitForExit: () => exited, close: vi.fn(async () => { exit(0); }) };
  const signal = new AbortController();
  const tools = createHostPersistentShells({
    machine: { sandbox: { startAttachedProcess: async () => process } } as never,
    spec: { taskDir, envRoot: taskDir, env: {} } as never,
    signal: signal.signal
  });
  const session = await tools.persistentShell({ action: "start", envOverrides: {} }) as { session_id: string };
  return { tools, process, taskDir, id: session.session_id, signal };
}

it("waits for trailing output to be saved before reporting command completion", async () => {
  const fixture = await setup();
  try {
    const running = await fixture.tools.persistentShell({ action: "run", sessionId: fixture.id, command: "echo hello", force: false, envOverrides: {} }) as { command_id: string };
    const append = fs.appendFile.bind(fs);
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    vi.spyOn(fs, "appendFile").mockImplementation(async (...args) => { await blocked; return append(...args); });
    fixture.process.stdout.write(`hello\nMEOWBERT_${running.command_id}_0\n`);
    let resolved = false;
    const status = fixture.tools.readShellSessionWaitState({ sessionId: fixture.id }).then((value) => { resolved = true; return value; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    finish();
    expect(await status).toMatchObject({ status: "idle", exitCode: 0, output: expect.stringContaining("hello") });
  } finally {
    fixture.signal.abort(); await fixture.process.close();
    await fs.rm(fixture.taskDir, { recursive: true, force: true });
  }
});

it("keeps an explicitly stopped session stopped after its process exits", async () => {
  const fixture = await setup();
  try {
    expect(await fixture.tools.persistentShell({ action: "stop", sessionId: fixture.id })).toMatchObject({ status: "stopped" });
    await Promise.resolve();
    expect(await fixture.tools.persistentShell({ action: "status", sessionId: fixture.id })).toMatchObject({ status: "stopped" });
  } finally {
    fixture.signal.abort();
    await fs.rm(fixture.taskDir, { recursive: true, force: true });
  }
});
