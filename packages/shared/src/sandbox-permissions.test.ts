import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureSandboxReadablePath, ensureSandboxWritablePath } from "./sandbox-permissions.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (root) => {
    await fs.rm(root, { recursive: true, force: true });
  }));
});

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-sandbox-perms-"));
  tempRoots.push(root);
  return root;
}

describe("ensureSandboxReadablePath", () => {
  it("normalizes directory chains and file readability", async () => {
    const root = await createTempRoot();
    const nestedDir = path.join(root, ".meowbert", "task-runs", "task-1", "inputs");
    const targetFile = path.join(nestedDir, "brief.txt");

    await fs.mkdir(nestedDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(targetFile, "brief", { mode: 0o600 });
    await fs.chmod(path.join(root, ".meowbert"), 0o700);
    await fs.chmod(path.join(root, ".meowbert", "task-runs"), 0o700);
    await fs.chmod(path.join(root, ".meowbert", "task-runs", "task-1"), 0o700);
    await fs.chmod(nestedDir, 0o700);

    await ensureSandboxReadablePath({
      rootPath: root,
      targetPath: targetFile
    });

    expect((await fs.stat(path.join(root, ".meowbert"))).mode & 0o777).toBe(0o755);
    expect((await fs.stat(path.join(root, ".meowbert", "task-runs", "task-1"))).mode & 0o777).toBe(0o755);
    expect((await fs.stat(nestedDir)).mode & 0o777).toBe(0o755);
    expect((await fs.stat(targetFile)).mode & 0o777).toBe(0o644);
  });
});

describe("ensureSandboxWritablePath", () => {
  it("opens a written file and its directory chain for the sandbox", async () => {
    const root = await createTempRoot();
    const taskDir = path.join(root, ".meowbert", "task-runs", "task-1");
    const inputsDir = path.join(taskDir, "inputs");
    const targetFile = path.join(inputsDir, "draft.docx");

    await fs.mkdir(inputsDir, { recursive: true, mode: 0o755 });
    await fs.writeFile(targetFile, "hello", { mode: 0o644 });
    await fs.chmod(path.join(root, ".meowbert"), 0o755);
    await fs.chmod(path.join(root, ".meowbert", "task-runs"), 0o755);
    await fs.chmod(taskDir, 0o755);
    await fs.chmod(inputsDir, 0o755);
    await fs.chmod(targetFile, 0o644);

    await ensureSandboxWritablePath({
      rootPath: root,
      targetPath: targetFile
    });

    expect((await fs.stat(path.join(root, ".meowbert"))).mode & 0o775).toBe(0o775);
    expect((await fs.stat(path.join(root, ".meowbert", "task-runs"))).mode & 0o775).toBe(0o775);
    expect((await fs.stat(taskDir)).mode & 0o775).toBe(0o775);
    expect((await fs.stat(inputsDir)).mode & 0o775).toBe(0o775);
    expect((await fs.stat(targetFile)).mode & 0o7777).toBe(0o664);
  });
});
