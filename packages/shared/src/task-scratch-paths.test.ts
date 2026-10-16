import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeTaskScratchDirs, removeWorkspaceScratchDir, resolveTaskScratchDir } from "./task-scratch-paths.js";

const tempDirs: string[] = [];

function createScratchRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-scratch-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("task scratch paths", () => {
  it("rejects ids that would escape the scratch root", () => {
    const root = createScratchRoot();
    expect(() => resolveTaskScratchDir(root, "../other", "task-1")).toThrow();
    expect(() => resolveTaskScratchDir(root, "workspace-1", "../../etc")).toThrow();
    expect(() => resolveTaskScratchDir(root, "workspace-1", "")).toThrow();
  });

  it("removes only the listed tasks' scratch", async () => {
    const root = createScratchRoot();
    const removed = resolveTaskScratchDir(root, "workspace-1", "task-1");
    const kept = resolveTaskScratchDir(root, "workspace-1", "task-2");
    fs.mkdirSync(path.join(removed, "repo", ".git"), { recursive: true });
    fs.mkdirSync(kept, { recursive: true });

    await removeTaskScratchDirs(root, "workspace-1", ["task-1"]);

    expect(fs.existsSync(removed)).toBe(false);
    expect(fs.existsSync(kept)).toBe(true);
  });

  it("removes a deleted workspace's scratch without touching the root", async () => {
    const root = createScratchRoot();
    fs.mkdirSync(resolveTaskScratchDir(root, "workspace-1", "task-1"), { recursive: true });
    fs.mkdirSync(resolveTaskScratchDir(root, "workspace-2", "task-1"), { recursive: true });

    await removeWorkspaceScratchDir(root, "workspace-1");

    expect(fs.readdirSync(root)).toEqual(["workspace-2"]);
  });
});
