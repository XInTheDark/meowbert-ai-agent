import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createHostMachineProvider } from "./host-machine-host";
import { cleanupHostProcesses } from "./host-processes";
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
  const result = await machine.sandbox.executeShellCommand({ command: "printf native", shell: "/bin/sh", workingDir: spec.taskDir, timeoutMs: 10_000, maxOutputKb: 4 });
  expect(result).toMatchObject({ stdout: "native", exitCode: 0 });
  await machine.stop();
  await expect(machine.sandbox.startAttachedProcess({ command: ["/bin/sh", "-c", "true"], workingDir: spec.taskDir, tty: false })).rejects.toThrow("fenced");
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
  const process = await machine.sandbox.startAttachedProcess({ command: ["/bin/sh", "-c", "sleep 300"], workingDir: spec.taskDir, tty: false });
  const pids = JSON.parse(await fs.readFile(path.join(runsRoot, spec.runId + ".pids"), "utf8"));
  expect(pids).toHaveLength(1);
  await cleanupHostProcesses(runsRoot);
  expect(await process.waitForExit()).not.toBe(0);
  await machine.stop();
}, 20_000);
