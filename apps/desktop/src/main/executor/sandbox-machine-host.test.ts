import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ create: vi.fn(), stop: vi.fn() }));
vi.mock("@meowbert/shared/docker-sandbox", () => ({ DockerSandboxManager: class { createPersistentSandbox = calls.create; } }));
vi.mock("@meowbert/run-executor/agent/task-write-scope", () => ({ buildTaskSandboxMounts: async () => [] }));
import { createDesktopSandboxMachineProvider } from "./sandbox-machine-host";
const run = promisify(execFile);
it("checks backend identity and write/delete access before starting the agent container", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"meowbert-probe-"));
  calls.create.mockReset(); calls.stop.mockReset();
  calls.create.mockImplementation(async () => ({stop:calls.stop,executeShellCommand:async (input:{command:string;workingDir:string}) => {
    try { const result = await run("/bin/bash",["-c",input.command],{cwd:input.workingDir}); return {...result,exitCode:0}; }
    catch (error) { return {exitCode:1,stderr:String(error)}; }
  }}));
  try {
    await fs.writeFile(path.join(root,".meowbert-storage.json"),JSON.stringify({version:1,backendId:"backend",installId:"install"}));
    const provider = createDesktopSandboxMachineProvider({image:"image",storageRoot:root,backendId:"backend",installId:"install",deviceId:"device",scratchRoot:root,skillsRootDir:null});
    await provider.start({taskDir:path.join(root,"task"),resources:{memoryMb:8192,cpus:8,pids:1024,storageMb:8192},log:vi.fn()} as never);
    expect(calls.create).toHaveBeenCalledTimes(2);
    expect(calls.create.mock.calls[1][0].resources).toEqual({memoryMb:2048,cpus:2,pids:256});
    expect(await fs.readdir(root)).not.toContain(".meowbert-probe-device");
    calls.create.mockClear();
    await fs.writeFile(path.join(root,".meowbert-storage.json"),JSON.stringify({version:1,backendId:"backend",installId:"another-install"}));
    await expect(provider.start({taskDir:path.join(root,"task"),resources:{memoryMb:8192,cpus:8,pids:1024,storageMb:8192},log:vi.fn()} as never)).rejects.toThrow(/cannot access/);
    expect(calls.create).toHaveBeenCalledTimes(1);
    expect(calls.stop).toHaveBeenCalledTimes(2);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
