import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { localRunRelocationNote } from "./local-run-paths";

it("retains relocation context unchanged across later runs and folder relinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-run-paths-"));
  try {
    const task = path.join(root, "task");
    const original = { workspaceRoot: "/old/workspace", envRoot: "/old/project" };
    const relocated = { workspaceRoot: "/new/workspace", envRoot: "/new/project" };
    expect(await localRunRelocationNote(task, original)).toBeUndefined();
    expect(await localRunRelocationNote(task, original)).toBeUndefined();
    const note = await localRunRelocationNote(task, relocated);
    expect(note).toContain(original.workspaceRoot);
    expect(note).toContain(relocated.workspaceRoot);
    expect(await localRunRelocationNote(task, relocated)).toBe(note);
    await fs.rename(task, path.join(root, "relinked"));
    expect(await localRunRelocationNote(path.join(root, "relinked"), relocated)).toBe(note);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
