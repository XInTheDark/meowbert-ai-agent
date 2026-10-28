import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { setProjectContextNote } from "@meowbert/shared/project-context";
import { loadProjectContextPromptData } from "./project-context.js";

it("keeps linked-folder notes and native paths without reading the mounted directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "linked-context-"));
  const linked = path.join(root, "context/Drive");
  await fs.mkdir(linked, { recursive: true });
  await fs.writeFile(path.join(linked, "should-not-be-listed.txt"), "remote");
  await fs.writeFile(path.join(root, "context/notes.txt"), "local");
  const read = vi.spyOn(fs, "readdir");
  const stat = vi.spyOn(fs, "lstat");
  try {
    const context = await loadProjectContextPromptData(root, setProjectContextNote({}, "context/Drive", "Current references"),
      [{ relativePath: "context/Drive", absolutePath: "/owned/native-mount/Drive" }]);
    expect(context?.entries).toEqual([
      { relativePath: "context/Drive", absolutePath: "/owned/native-mount/Drive", kind: "directory", note: "Current references" },
      expect.objectContaining({ relativePath: "context/notes.txt", kind: "file" })
    ]);
    expect(read.mock.calls.some(([value]) => value === linked)).toBe(false);
    expect(stat.mock.calls.some(([value]) => value === linked)).toBe(false);
  } finally { read.mockRestore(); stat.mockRestore(); await fs.rm(root, { recursive: true, force: true }); }
});

it("includes metadata-only device folders even when no local context directory exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "device-context-"));
  try {
    const context = await loadProjectContextPromptData(root, {}, [{ relativePath: "context/Drive", absolutePath: "/owned/native/Drive" }]);
    expect(context?.entries).toEqual([{ relativePath: "context/Drive", absolutePath: "/owned/native/Drive", kind: "directory", note: null }]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("lists only the top level of context plus noted deeper paths, without reading nested folders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shallow-context-"));
  const nested = path.join(root, "context/specs");
  await fs.mkdir(path.join(nested, "deep"), { recursive: true });
  await fs.writeFile(path.join(nested, "api.yaml"), "openapi: 3.1");
  await fs.writeFile(path.join(root, "context/brief.md"), "brief");
  const read = vi.spyOn(fs, "readdir");
  const stat = vi.spyOn(fs, "lstat");
  try {
    const context = await loadProjectContextPromptData(root, setProjectContextNote({}, "context/specs/api.yaml", "Public API"));
    expect(context?.entries.map(({ relativePath, kind, note }) => ({ relativePath, kind, note }))).toEqual([
      { relativePath: "context/brief.md", kind: "file", note: null },
      { relativePath: "context/specs", kind: "directory", note: null },
      { relativePath: "context/specs/api.yaml", kind: "path", note: "Public API" }
    ]);
    expect(read.mock.calls.map(([value]) => value)).toEqual([path.join(root, "context")]);
    expect(stat).not.toHaveBeenCalled();
  } finally { read.mockRestore(); stat.mockRestore(); await fs.rm(root, { recursive: true, force: true }); }
});
