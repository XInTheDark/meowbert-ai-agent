import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config.js", () => ({
  config: {
    db: {
      url: "postgres://postgres:postgres@127.0.0.1:5432/meowbert-test"
    },
    memory: {
      indexCacheRoot: "/tmp/meowbert-memory-index-tests"
    },
    runtime: {
      tasksRoot: "/tmp/meowbert-runtime-tasks",
      workerConcurrency: 4
    }
  }
}));

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(async () => ({ rows: [{ api_key: "test-key", base_url: "https://api.openai.com/v1" }] }))
}));

import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";
import {
  ensureProjectMemoryDir,
  ensureWorkspaceMemoryDir,
  readProjectMemoryMainFile,
  readWorkspaceMemoryMainFile,
  searchMemoryIndex,
  stopWorkspaceMemoryWatchers,
  syncWorkspaceMemoryNow
} from "./index.js";
import { getWorkspaceMemoryPaths } from "./shared.js";

function embedText(text: string): number[] {
  const lower = text.toLowerCase();
  return [
    lower.includes("pnpm") ? 10 : 0,
    lower.includes("yarn") ? 10 : 0,
    lower.includes("typescript") ? 5 : 0,
    Math.min(lower.length / 100, 5)
  ];
}

vi.mock("../agent/openai-client.js", () => ({
  getOpenAiClient: (provider: { baseUrl: string }) => ({
    embeddings: {
      create: async ({ input }: { input: string | string[] }) => {
        const items = Array.isArray(input) ? input : [input];
        return {
          data: items.map((text, index) => ({
            index,
            embedding: provider.baseUrl === "https://new-embeddings.test/v1" ? [...embedText(text), 1] : embedText(text)
          }))
        };
      }
    }
  })
}));

beforeEach(() => {
  vi.mocked(query).mockResolvedValue({ rows: [{ api_key: "test-key", base_url: "https://api.openai.com/v1" }] } as never);
});

afterEach(async () => {
  await stopWorkspaceMemoryWatchers();
});

describe("workspace memory indexing", () => {
  it("rebuilds on search after the selected provider changes embedding dimensions", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-memory-provider-"));
    const memoryDir = path.join(workspaceRoot, ".memory");
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, "preferences.md"), "Use pnpm for package management.");
    try {
      await syncWorkspaceMemoryNow(workspaceRoot);
      const { manifestPath } = getWorkspaceMemoryPaths(workspaceRoot);
      const before = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      vi.mocked(query).mockResolvedValue({ rows: [{ api_key: "new-key", base_url: "https://new-embeddings.test/v1" }] } as never);
      const result = await searchMemoryIndex({ workspaceRoot, query: "pnpm", limit: 5 });
      expect(result.sync_status.state).toBe("ready");
      expect(result.items[0]?.text).toContain("pnpm");
      const after = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(after.embedding_config_hash).not.toBe(before.embedding_config_hash);
    } finally {
      await stopWorkspaceMemoryWatchers();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("stores derived memory index artifacts under the local cache root instead of the workspace root", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-memory-workspace-"));

    try {
      const paths = getWorkspaceMemoryPaths(workspaceRoot);
      const memoryConfig = config.memory as { indexCacheRoot?: string } | undefined;
      const indexCacheRoot = memoryConfig?.indexCacheRoot ?? "";

      expect(paths.memoryDir).toBe(path.join(workspaceRoot, ".memory"));
      expect(paths.indexDir.startsWith(workspaceRoot)).toBe(false);
      expect(paths.dbDir.startsWith(workspaceRoot)).toBe(false);
      expect(paths.indexDir.startsWith(indexCacheRoot)).toBe(true);
      expect(paths.statusPath.startsWith(indexCacheRoot)).toBe(true);
      expect(paths.manifestPath.startsWith(indexCacheRoot)).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("creates a default MEMORY.md file", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-memory-workspace-"));

    try {
      const memoryDir = await ensureWorkspaceMemoryDir(workspaceRoot);
      const mainFilePath = path.join(memoryDir, "MEMORY.md");
      expect(fs.existsSync(mainFilePath)).toBe(true);

      const mainFile = await readWorkspaceMemoryMainFile(workspaceRoot);
      expect(mainFile.path).toBe(mainFilePath);
      expect(mainFile.content).toContain("# MEMORY");
      expect(mainFile.content).toContain("Key commands and workflows");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("creates a default project MEMORY.md file under workspace memory", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-memory-workspace-"));
    const projectId = "11111111-1111-4111-8111-111111111111";

    try {
      const projectMemoryDir = await ensureProjectMemoryDir({
        workspaceRoot,
        projectId,
        projectName: "Research"
      });
      const mainFilePath = path.join(projectMemoryDir, "MEMORY.md");
      expect(mainFilePath).toBe(path.join(workspaceRoot, ".memory", "projects", projectId, "MEMORY.md"));
      expect(fs.existsSync(mainFilePath)).toBe(true);

      const mainFile = await readProjectMemoryMainFile({
        workspaceRoot,
        projectId,
        projectName: "Research"
      });
      expect(mainFile.path).toBe(mainFilePath);
      expect(mainFile.content).toContain("# PROJECT MEMORY");
      expect(mainFile.content).toContain("Research");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("indexes and searches workspace memory files", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-memory-workspace-"));
    const memoryDir = path.join(workspaceRoot, ".memory");
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, "preferences.md"), "Use pnpm for package management.\nPrefer TypeScript.");

    try {
      await syncWorkspaceMemoryNow(workspaceRoot);
      const result = await searchMemoryIndex({
        workspaceRoot,
        query: "pnpm",
        limit: 5
      });

      expect(result.sync_status.state).toBe("ready");
      expect(result.items[0]?.relative_path).toBe(".memory/preferences.md");
      expect(result.items[0]?.text).toContain("pnpm");
      expect(result.items[0]?.line_start).toBe(1);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("restricts memory search to workspace or current project scope", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-memory-workspace-"));
    const memoryDir = path.join(workspaceRoot, ".memory");
    const projectId = "11111111-1111-4111-8111-111111111111";
    const projectMemoryDir = path.join(memoryDir, "projects", projectId);
    fs.mkdirSync(projectMemoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, "preferences.md"), "Use pnpm for workspace package management.");
    fs.writeFileSync(path.join(projectMemoryDir, "next-steps.md"), "Use pnpm to rebuild the project-specific dashboard.");

    try {
      await syncWorkspaceMemoryNow(workspaceRoot);
      const projectResult = await searchMemoryIndex({
        workspaceRoot,
        currentProjectId: projectId,
        query: "pnpm",
        limit: 5,
        scope: "current_project"
      });
      expect(projectResult.items.map((item) => item.relative_path)).toEqual([
        `.memory/projects/${projectId}/next-steps.md`
      ]);

      const workspaceResult = await searchMemoryIndex({
        workspaceRoot,
        currentProjectId: projectId,
        query: "pnpm",
        limit: 5,
        scope: "workspace"
      });
      expect(workspaceResult.items.some((item) => item.relative_path === ".memory/preferences.md")).toBe(true);
      expect(workspaceResult.items.some((item) => item.relative_path.startsWith(".memory/projects/"))).toBe(false);

      const pathResult = await searchMemoryIndex({
        workspaceRoot,
        query: "pnpm",
        limit: 5,
        scope: "all",
        paths: [`.memory/projects/${projectId}/`]
      });
      expect(pathResult.items.map((item) => item.relative_path)).toEqual([
        `.memory/projects/${projectId}/next-steps.md`
      ]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("updates search results after file edits and deletions", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-memory-workspace-"));
    const memoryDir = path.join(workspaceRoot, ".memory");
    const notePath = path.join(memoryDir, "tooling.md");
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(notePath, "Use pnpm in this repo.");

    try {
      await syncWorkspaceMemoryNow(workspaceRoot);
      let result = await searchMemoryIndex({
        workspaceRoot,
        query: "pnpm",
        limit: 5
      });
      expect(result.items[0]?.text).toContain("pnpm");

      fs.writeFileSync(notePath, "Use yarn in this repo.");
      await syncWorkspaceMemoryNow(workspaceRoot);
      result = await searchMemoryIndex({
        workspaceRoot,
        query: "yarn",
        limit: 5
      });
      expect(result.items[0]?.text).toContain("yarn");
      expect(result.items[0]?.relative_path).toBe(".memory/tooling.md");

      fs.rmSync(notePath, { force: true });
      await syncWorkspaceMemoryNow(workspaceRoot);
      result = await searchMemoryIndex({
        workspaceRoot,
        query: "yarn",
        limit: 5
      });
      expect(result.items.some((item) => item.relative_path === ".memory/tooling.md")).toBe(false);
      expect(result.sync_status.search_target).toBe("lancedb");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rebuilds the memory index when the Lance dataset disappears but the manifest remains", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-memory-workspace-"));
    const memoryDir = path.join(workspaceRoot, ".memory");
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, "recovery.md"), "Use pnpm for recovery checks.");

    try {
      await syncWorkspaceMemoryNow(workspaceRoot);
      const { dbDir } = getWorkspaceMemoryPaths(workspaceRoot);
      fs.rmSync(path.join(dbDir, "memory_chunks_v1.lance"), { recursive: true, force: true });

      await syncWorkspaceMemoryNow(workspaceRoot);
      const result = await searchMemoryIndex({
        workspaceRoot,
        query: "recovery",
        limit: 5
      });
      const recoveryItem = result.items.find((item) => item.relative_path === ".memory/recovery.md");

      expect(result.sync_status.state).toBe("ready");
      expect(recoveryItem?.text).toContain("recovery");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
