import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import type { SandboxAttachedProcess, StartAttachedProcessInput } from "@meowbert/shared/docker-sandbox";
import type { Writable } from "node:stream";

// The gate prevents the command starting until its process group is recorded on disk.
const LAUNCHER = `
const fs = require("node:fs");
const gate = Buffer.alloc(1);
if (fs.readSync(3, gate, 0, 1, null) !== 1 || gate[0] !== 49) process.exit(1);
const command = JSON.parse(process.argv[1]);
const child = require("node:child_process").spawn(command[0], command.slice(1), { stdio: "inherit", windowsHide: true });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
`;

async function signalGroup(pid: number, force: boolean): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => execFile("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], (error) => {
      if (error && ![128, 255].includes(Number(error.code))) reject(error); else resolve();
    }));
    return;
  }
  try { process.kill(-pid, force ? "SIGKILL" : "SIGTERM"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}

export async function killHostProcessGroup(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error("Invalid host process group.");
  await signalGroup(pid, false);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  await signalGroup(pid, true);
}

/** Only the desktop-owned runs directory is listed; workspace trees are never scanned. */
export async function cleanupHostProcesses(runsRoot: string): Promise<void> {
  const names = await fs.readdir(runsRoot).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of names.filter((name) => /^[a-f0-9-]+(?:-tools)?\.pids$/i.test(name))) {
    const file = path.join(runsRoot, name);
    const pids: number[] = JSON.parse(await fs.readFile(file, "utf8"));
    await Promise.all(pids.map(killHostProcessGroup));
    await fs.unlink(file);
  }
}

export class HostProcesses {
  private readonly pids = new Set<number>();
  private pending: Promise<unknown> = Promise.resolve();
  private stopped = false;
  constructor(private readonly file: string, private readonly env: Record<string, string> = {}) {}

  private persist(): Promise<void> {
    const value = JSON.stringify([...this.pids]);
    const work = this.pending.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file + ".tmp", value, { mode: 0o600 });
      await fs.rename(this.file + ".tmp", this.file);
    });
    this.pending = work.catch(() => undefined);
    return work;
  }

  async start(input: StartAttachedProcessInput): Promise<SandboxAttachedProcess> {
    if (this.stopped) throw new Error("The host run has been fenced.");
    const child = spawn(process.execPath, ["-e", LAUNCHER, JSON.stringify(input.command)], {
      cwd: input.workingDir, detached: true, windowsHide: true,
      env: { ...process.env, ...this.env, ...input.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe", "pipe"]
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    void exited.catch(() => undefined);
    if (!child.pid) { await exited; throw new Error("Host process failed to start."); }
    const pid = child.pid;
    this.pids.add(pid);
    try {
      await this.persist();
      if (this.stopped) throw new Error("The host run has been fenced.");
      (child.stdio[3] as Writable).end("1");
    } catch (error) { await killHostProcessGroup(pid); throw error; }
    let closing: Promise<void> | null = null;
    const close = () => closing ??= killHostProcessGroup(pid).then(async () => {
      this.pids.delete(pid);
      await this.persist();
    });
    // A command may leave background children in its group even after its shell exits.
    void exited.then(close).catch(() => undefined);
    return { stdin: input.stdin ? child.stdin : null, stdout: child.stdout!, stderr: child.stderr,
      close, waitForExit: () => exited };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.pending;
    if (this.pids.size === 0) return;
    await Promise.all([...this.pids].map(killHostProcessGroup));
    this.pids.clear();
    await this.persist();
  }
}
