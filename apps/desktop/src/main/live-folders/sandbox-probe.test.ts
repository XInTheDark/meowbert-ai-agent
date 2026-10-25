import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./native-mount", () => ({ isNativeLiveFolderMounted: vi.fn() }));
import { isNativeLiveFolderMounted } from "./native-mount";
import { verifySandboxLiveFolders } from "./sandbox-probe";
const run = promisify(execFile);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isNativeLiveFolderMounted).mockResolvedValue(true); });

it.each([false, true])("verifies folder visibility and removes probes, readOnly=%s", async (readOnly) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-drive-probe-"));
  const folder = path.join(root, "folder with 'quotes'");
  await fs.mkdir(folder);
  const executeShellCommand = vi.fn(async (input: { command: string; workingDir: string }) => {
    const result = await run("/bin/sh", ["-c", input.command], { cwd: input.workingDir });
    return { ...result, command: input.command, exitCode: 0, timedOut: false, aborted: false };
  });
  try {
    await verifySandboxLiveFolders({ sandbox: { executeShellCommand }, paths: [folder, folder], taskDir: root, readOnly });
    expect(executeShellCommand).toHaveBeenCalledOnce();
    expect(await fs.readdir(folder)).toEqual([]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it.each(["unmounted", "invisible", "missing_reply", "disappeared"])("waits for storage and cleans up when a folder is %s", async (failure) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-drive-probe-"));
  const executeShellCommand = vi.fn().mockResolvedValue({ exitCode: failure === "invisible" ? 1 : 0 });
  if (failure === "unmounted") vi.mocked(isNativeLiveFolderMounted).mockResolvedValue(false);
  if (failure === "disappeared") vi.mocked(isNativeLiveFolderMounted).mockResolvedValueOnce(true).mockResolvedValue(false);
  try {
    await expect(verifySandboxLiveFolders({ sandbox: { executeShellCommand }, paths: [root], taskDir: root,
      readOnly: failure === "disappeared" })).rejects.toThrow("Docker Desktop cannot access a live Google Drive folder");
    expect(await fs.readdir(root)).toEqual([]);
    if (failure === "unmounted") expect(executeShellCommand).not.toHaveBeenCalled();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
