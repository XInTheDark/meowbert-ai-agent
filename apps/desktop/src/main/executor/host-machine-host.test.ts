import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { createHostMachineProvider } from "./host-machine-host";
import { cleanupHostProcesses, HostProcesses } from "./host-processes";
import type { MachineSpec } from "@meowbert/run-executor/agent/ports/machine-host";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(consent = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-host-")); roots.push(root);
  const spec = { runId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", taskDir: root, envRoot: root, env: {}, isThreadTask: false } as MachineSpec;
  const runsRoot = path.join(root, "runs");
  return { spec, runsRoot, provider: createHostMachineProvider({ scratchRoot: root, runsRoot, consent }) };
}
it("runs native commands and refuses new work after fencing", async () => {
  const { spec, provider } = await fixture();
  const machine = await provider.start(spec);
  const windows = process.platform === "win32";
  const result = await machine.sandbox.executeShellCommand({ command: windows ? "[Console]::Write('native')" : "printf native",
    shell: windows ? "powershell.exe" : "/bin/sh", workingDir: spec.taskDir, timeoutMs: 10_000, maxOutputKb: 4 });
  expect(result).toMatchObject({ stdout: "native", exitCode: 0 });
  await machine.stop();
  await expect(machine.sandbox.startAttachedProcess({ command: [process.execPath, "-e", "process.exit(0)"], workingDir: spec.taskDir, tty: false })).rejects.toThrow("fenced");
}, 20_000);
it("requires consent and refuses read-only host threads", async () => {
  const { spec, provider } = await fixture(false);
  await expect(provider.start(spec)).rejects.toThrow("consent");
  const allowed = await fixture();
  await expect(allowed.provider.start({ ...allowed.spec, isThreadTask: true })).rejects.toThrow("Read-only");
});
it("records command groups before execution and cleans them after a simulated app crash", async () => {
  const { spec, provider, runsRoot } = await fixture();
  const machine = await provider.start(spec);
  const attached = await machine.sandbox.startAttachedProcess({ command: [process.execPath, "-e", "setInterval(() => {}, 1000)"], workingDir: spec.taskDir, tty: false });
  const pids = JSON.parse(await fs.readFile(path.join(runsRoot, spec.runId + ".pids"), "utf8"));
  expect(pids).toHaveLength(1);
  await cleanupHostProcesses(runsRoot);
  expect(await attached.waitForExit()).not.toBe(0);
  await machine.stop();
}, 20_000);

it("terminates background descendants after their launching command exits", async () => {
  const { spec, runsRoot } = await fixture();
  const processes = new HostProcesses(path.join(runsRoot, spec.runId + ".pids"));
  const childPidFile = path.join(spec.taskDir, "background.pid");
  const childScript = "setInterval(() => {}, 1000)";
  const script = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    const child=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});
    fs.writeFileSync(${JSON.stringify(childPidFile)},String(child.pid)); child.unref();`;
  try {
    const attached = await processes.start({ command: [process.execPath, "-e", script], workingDir: spec.taskDir, tty: false });
    expect(await attached.waitForExit()).toBe(0);
    const pid = Number(await fs.readFile(childPidFile, "utf8"));
    await attached.close();
    if (process.platform === "win32") {
      expect(() => process.kill(pid, 0)).toThrow();
    } else {
      const status = await new Promise<string>((resolve) => execFile("ps", ["-p", String(pid), "-o", "stat="], (_error, stdout) => resolve(stdout.trim())));
      expect(status === "" || status.startsWith("Z")).toBe(true);
    }
  } finally { await processes.stop(); }
}, 20_000);

it("discards a stale journal when its PID belongs to an unrelated process", async () => {
  const { spec, runsRoot } = await fixture();
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  const exited = new Promise((resolve) => unrelated.once("exit", resolve));
  try {
    await fs.mkdir(runsRoot);
    await fs.writeFile(path.join(runsRoot, spec.runId + ".pids"), JSON.stringify([{ pid: unrelated.pid, token: "stale-unrelated-owner" }]));
    await cleanupHostProcesses(runsRoot);
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    expect(await fs.readdir(runsRoot)).toEqual([]);
  } finally { unrelated.kill(); await exited; }
}, 20_000);
