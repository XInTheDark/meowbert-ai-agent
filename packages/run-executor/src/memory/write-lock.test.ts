import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withMemoryWriteLock } from "./write-lock.js";
import { saveIndexEntry } from "../file-index/save.js";
import { lookupIndex } from "../file-index/lookup.js";
import { readWorkspaceMemoryMainFile, readProjectMemoryMainFile } from "./main-files.js";

let workspaceRoot: string;
beforeEach(async () => { workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "memory-write-lock-")); });
afterEach(async () => { await fs.rm(workspaceRoot, { recursive: true, force: true }); });

describe("cooperative Memory writes", () => {
  it("releases the lock after an edit fails and leaves direct filesystem editing available", async () => {
    await expect(withMemoryWriteLock(workspaceRoot, async () => { throw new Error("edit failed"); })).rejects.toThrow("edit failed");
    await withMemoryWriteLock(workspaceRoot, async () => { await fs.writeFile(path.join(workspaceRoot, ".memory/note.md"), "first"); });
    await fs.appendFile(path.join(workspaceRoot, ".memory/note.md"), " direct");
    expect(await fs.readFile(path.join(workspaceRoot, ".memory/note.md"), "utf8")).toBe("first direct");
    expect(await fs.readdir(workspaceRoot)).toEqual([".memory"]);
  });

  it("shares its lock with independent processes", async () => {
    const run = promisify(execFile);
    const lockfilePath = createRequire(import.meta.url).resolve("proper-lockfile");
    const child = `
      const lockfile = require(process.argv[1]);
      lockfile.lock(process.argv[2], { lockfilePath: process.argv[3], stale: 60000, update: 10000 })
        .then(async (release) => { await release(); process.stdout.write('acquired'); })
        .catch((error) => { if (error.code !== 'ELOCKED') throw error; process.stdout.write('busy'); });
    `;
    const args = ["-e", child, lockfilePath, path.join(workspaceRoot, ".memory"), path.join(workspaceRoot, ".memory.write.lock")];
    await withMemoryWriteLock(workspaceRoot, async () => {
      expect((await run(process.execPath, args)).stdout).toBe("busy");
    });
    expect((await run(process.execPath, args)).stdout).toBe("acquired");
  });

  it("merges an index update after a coordinated shell edit finishes", async () => {
    const roots = { workspaceRoot, envRoot: path.join(workspaceRoot, "project"), projectId: "p1" };
    await fs.mkdir(roots.envRoot);
    await fs.writeFile(path.join(roots.envRoot, "source.md"), "source");
    const input = { sources: ["source.md"], summary: "Initial.", mode: "replace" as const, name: null };
    const saved = await saveIndexEntry(roots, input);
    let update!: Promise<unknown>;
    await withMemoryWriteLock(workspaceRoot, async () => {
      update = saveIndexEntry(roots, { ...input, mode: "append_update", summary: "Index contribution." });
      await fs.appendFile(saved.entry_path, "\nShell contribution.\n");
    });
    await update;
    const result = await lookupIndex(roots, "source.md");
    expect(result.entries[0].content).toContain("Shell contribution.");
    expect(result.entries[0].content).toContain("Index contribution.");
  });

  it("does not run an edit after cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    let edited = false;
    await expect(withMemoryWriteLock(workspaceRoot, async () => { edited = true; }, controller.signal)).rejects.toThrow("cancelled");
    expect(edited).toBe(false);
  });

  it("does not overwrite a newly created memory while another run initializes it", async () => {
    const originalRead = fs.readFile.bind(fs);
    const spy = vi.spyOn(fs, "readFile");
    const target = path.join(workspaceRoot, ".memory/MEMORY.md");
    await fs.mkdir(path.dirname(target));
    spy.mockImplementationOnce(async () => {
      await fs.writeFile(target, "Another run's notes.");
      throw Object.assign(new Error("not found in earlier read"), { code: "ENOENT" });
    });
    try {
      expect((await readWorkspaceMemoryMainFile(workspaceRoot)).content).toBe("Another run's notes.");
      expect(await originalRead(target, "utf8")).toBe("Another run's notes.");
      const project = await readProjectMemoryMainFile({ workspaceRoot, projectId: "p1" });
      expect(project.content).toContain("# PROJECT MEMORY");
    } finally { spy.mockRestore(); }
  });
});
