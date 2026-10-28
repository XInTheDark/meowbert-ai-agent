import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lookupIndex } from "./lookup.js";
import { saveIndexEntry } from "./save.js";

let workspaceRoot: string;
let roots: { workspaceRoot: string; envRoot: string; projectId: string };

async function writeSource(relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(roots.envRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content);
}

beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "file-index-"));
  roots = { workspaceRoot, envRoot: path.join(workspaceRoot, "projects", "p1"), projectId: "p1" };
  await writeSource("context/specs/api.yaml", "openapi: 3.1");
  await writeSource("context/specs/auth.md", "# Auth");
});

afterEach(async () => {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe("file index", () => {
  it("files project paths under project memory and reports them fresh until the source changes", async () => {
    const saved = await saveIndexEntry(roots, { sources: ["context/specs/api.yaml"], summary: "The public API.", mode: "replace", name: null });
    expect(saved.entry_path).toBe(path.join(workspaceRoot, ".memory/projects/p1/index/context/specs/api.yaml.md"));

    const fresh = await lookupIndex(roots, "context/specs/api.yaml");
    expect(fresh.entries).toEqual([expect.objectContaining({ covers: "this_path", status: "fresh", content: "The public API." })]);

    await fs.writeFile(path.join(roots.envRoot, "context/specs/api.yaml"), "openapi: 3.1\npaths: {}");
    const stale = await lookupIndex(roots, "context/specs/api.yaml");
    expect(stale.entries[0]).toMatchObject({ status: "stale", sources: [{ path: "context/specs/api.yaml", status: "changed" }] });
  });

  it("treats an older replacement mtime as a change", async () => {
    await saveIndexEntry(roots, { sources: ["context/specs/auth.md"], summary: "Auth notes.", mode: "replace", name: null });
    const source = path.join(roots.envRoot, "context/specs/auth.md");
    await fs.writeFile(source, "# Auth v2");
    await fs.utimes(source, new Date("2020-01-01"), new Date("2020-01-01"));
    const result = await lookupIndex(roots, source);
    expect(result.entries[0].status).toBe("stale");
  });

  it("returns groups that include a path and the summaries of folders above it", async () => {
    await saveIndexEntry(roots, { sources: ["context"], summary: "Everything the user shared.", mode: "replace", name: null });
    await saveIndexEntry(roots, {
      sources: ["context/specs/api.yaml", "context/specs/auth.md"],
      summary: "How auth and the API fit together.",
      mode: "replace",
      name: "Auth flow"
    });

    const result = await lookupIndex(roots, "context/specs/auth.md");
    expect(result.entries.map((entry) => [entry.covers, entry.entry_path.split("/index/")[1]])).toEqual([
      ["group", "context/specs/auth-flow.group.md"],
      ["parent_folder", "context/__folder__.md"]
    ]);
    expect(result.entries[1].content).toBeNull();
  });

  it("lists what is indexed inside a folder", async () => {
    await saveIndexEntry(roots, { sources: ["context/specs/api.yaml"], summary: "API.", mode: "replace", name: null });
    const result = await lookupIndex(roots, "context");
    expect(result.kind).toBe("folder");
    expect(result.child_entries).toEqual([expect.objectContaining({ kind: "folder", source_path: "context/specs" })]);
  });

  it("appends updates to the existing entry and restamps the source", async () => {
    await saveIndexEntry(roots, { sources: ["context/specs/api.yaml"], summary: "First read.", mode: "replace", name: null });
    await fs.writeFile(path.join(roots.envRoot, "context/specs/api.yaml"), "openapi: 3.1\nservers: []");
    await saveIndexEntry(roots, { sources: ["context/specs/api.yaml"], summary: "Adds servers.", mode: "append_update", name: null },
      new Date("2026-10-30T08:00:00.000Z"));

    const result = await lookupIndex(roots, "context/specs/api.yaml");
    expect(result.entries[0].status).toBe("fresh");
    expect(result.entries[0].content).toBe("First read.\n\n## Update 2026-10-30T08:00:00.000Z\n\nAdds servers.");
  });

  it("indexes workspace paths outside the project in workspace memory", async () => {
    await fs.mkdir(path.join(workspaceRoot, "shared"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "shared/brand.md"), "# Brand");
    const saved = await saveIndexEntry(roots, { sources: [path.join(workspaceRoot, "shared/brand.md")], summary: "Brand rules.", mode: "replace", name: null });
    expect(saved.entry_path).toBe(path.join(workspaceRoot, ".memory/index/shared/brand.md.md"));
  });

  it("rejects groups that mix project and workspace paths, and paths outside the workspace", async () => {
    await fs.writeFile(path.join(workspaceRoot, "notes.md"), "notes");
    await expect(saveIndexEntry(roots, {
      sources: ["context/specs/api.yaml", path.join(workspaceRoot, "notes.md")], summary: "Mixed.", mode: "replace", name: "mixed"
    })).rejects.toThrow("must all be inside the project");
    await expect(lookupIndex(roots, os.tmpdir())).rejects.toThrow("inside the workspace");
  });
});
