import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as childProcess from "node:child_process";
import { expect, it, vi } from "vitest";
import { HostProcesses } from "./host-processes";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

it.each(["ECONNRESET", "EPIPE", "EIO"])("retains cleanup after a %s process pipe error", async (code) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-pipe-"));
  const journal = path.join(root, "run.pids");
  const processes = new HostProcesses(journal);
  const spawn = vi.mocked(childProcess.spawn);
  try {
    const attached = await processes.start({ command: [process.execPath, "-e", "setInterval(() => {}, 1000)"], workingDir: root, tty: false });
    const child = spawn.mock.results[0].value as childProcess.ChildProcess;
    const error = Object.assign(new Error("Process pipe failed"), { code });
    child.stdio[4]!.emit("error", error);
    if (code === "EIO") await expect(attached.waitForExit()).rejects.toBe(error);
    await attached.close();
    if (code !== "EIO") expect(await attached.waitForExit()).not.toBe(0);
    expect(JSON.parse(await fs.readFile(journal, "utf8"))).toEqual([]);
    expect(() => process.kill(child.pid!, 0)).toThrow();
  } finally {
    spawn.mockClear();
    await processes.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 20_000);
