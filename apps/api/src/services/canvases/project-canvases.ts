import fs from "node:fs/promises";
import path from "node:path";
import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";
import { query } from "../../lib/db.js";

export type ProjectCanvasRuntimeMode = "static" | "dev_server";
export type ProjectCanvasIntent = "create" | "update" | "view";

export interface ProjectCanvasRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  name: string;
  slug: string;
  root_path: string;
  entry_path: string;
  runtime_mode: ProjectCanvasRuntimeMode;
  dev_server_json: Record<string, unknown>;
  created_by: string | null;
  last_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectCanvasSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  slug: string;
  rootPath: string;
  entryPath: string;
  runtimeMode: ProjectCanvasRuntimeMode;
  devServer: Record<string, unknown>;
  lastTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectCanvasManifest {
  title: string;
  entry: string;
  runtimeMode: ProjectCanvasRuntimeMode;
  devCommand: string | null;
  devPort: number | null;
  description: string | null;
}

function slugifyCanvasName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "canvas";
}

function normalizeEntryPath(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("..")) {
    return "index.html";
  }

  return trimmed.split(path.sep).join("/");
}

function normalizeRuntimeMode(value: unknown): ProjectCanvasRuntimeMode {
  return value === "dev_server" ? "dev_server" : "static";
}

function normalizeDevServerConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toSummary(row: ProjectCanvasRow): ProjectCanvasSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.environment_id,
    name: row.name,
    slug: row.slug,
    rootPath: row.root_path,
    entryPath: row.entry_path,
    runtimeMode: row.runtime_mode,
    devServer: row.dev_server_json ?? {},
    lastTaskId: row.last_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function slugExists(environmentId: string, slug: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `SELECT id FROM project_canvases WHERE environment_id = $1 AND slug = $2 LIMIT 1`,
    [environmentId, slug]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createAvailableCanvasSlug(environmentId: string, name: string): Promise<string> {
  const baseSlug = slugifyCanvasName(name);
  for (let index = 0; index < 100; index += 1) {
    const slug = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    if (!(await slugExists(environmentId, slug))) {
      return slug;
    }
  }

  throw new Error("Too many canvases with similar names");
}

function buildManifest(input: {
  name: string;
  entryPath: string;
  runtimeMode: ProjectCanvasRuntimeMode;
  devServer: Record<string, unknown>;
}): ProjectCanvasManifest {
  const devCommand = typeof input.devServer.command === "string" ? input.devServer.command : null;
  const devPort = typeof input.devServer.port === "number" && Number.isInteger(input.devServer.port)
    ? input.devServer.port
    : null;

  return {
    title: input.name,
    entry: input.entryPath,
    runtimeMode: input.runtimeMode,
    devCommand,
    devPort,
    description: null
  };
}

export async function ensureProjectCanvasFiles(input: {
  environmentRootPath: string;
  name: string;
  rootPath: string;
  entryPath: string;
  runtimeMode: ProjectCanvasRuntimeMode;
  devServer: Record<string, unknown>;
}): Promise<void> {
  const canvasDir = path.resolve(input.environmentRootPath, input.rootPath);
  await fs.mkdir(canvasDir, { recursive: true });
  const canvasDirRealPath = await fs.realpath(canvasDir);
  const entryPath = path.resolve(canvasDirRealPath, input.entryPath);
  const relativeEntryPath = path.relative(canvasDirRealPath, entryPath);
  if (relativeEntryPath.startsWith("..") || path.isAbsolute(relativeEntryPath)) {
    throw new Error("Invalid canvas entry path");
  }

  const manifestPath = path.resolve(canvasDir, "canvas.json");
  try {
    await fs.access(manifestPath);
  } catch {
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify(buildManifest(input), null, 2)}\n`,
      "utf8"
    );
  }
}

export async function listProjectCanvases(environmentId: string): Promise<ProjectCanvasSummary[]> {
  const result = await query<ProjectCanvasRow>(
    `SELECT id,
            workspace_id,
            environment_id,
            name,
            slug,
            root_path,
            entry_path,
            runtime_mode,
            dev_server_json,
            created_by,
            last_task_id,
            created_at,
            updated_at
       FROM project_canvases
      WHERE environment_id = $1
      ORDER BY updated_at DESC, id DESC`,
    [environmentId]
  );

  return result.rows.map(toSummary);
}

export async function listTaskCanvases(taskId: string): Promise<ProjectCanvasSummary[]> {
  const result = await query<ProjectCanvasRow>(
    `SELECT DISTINCT pc.id,
            pc.workspace_id,
            pc.environment_id,
            pc.name,
            pc.slug,
            pc.root_path,
            pc.entry_path,
            pc.runtime_mode,
            pc.dev_server_json,
            pc.created_by,
            pc.last_task_id,
            pc.created_at,
            pc.updated_at
       FROM project_canvases pc
       LEFT JOIN tasks t
         ON t.id = $1
        AND t.interactive_canvas_id = pc.id
      WHERE pc.last_task_id = $1
         OR t.id IS NOT NULL
      ORDER BY pc.updated_at DESC, pc.id DESC`,
    [taskId]
  );

  return result.rows.map(toSummary);
}

export async function getProjectCanvas(canvasId: string): Promise<ProjectCanvasSummary | null> {
  const result = await query<ProjectCanvasRow>(
    `SELECT id,
            workspace_id,
            environment_id,
            name,
            slug,
            root_path,
            entry_path,
            runtime_mode,
            dev_server_json,
            created_by,
            last_task_id,
            created_at,
            updated_at
       FROM project_canvases
      WHERE id = $1
      LIMIT 1`,
    [canvasId]
  );

  return result.rows[0] ? toSummary(result.rows[0]) : null;
}

export async function createProjectCanvas(input: {
  workspaceId: string;
  environmentId: string;
  environmentRootPath: string;
  name: string;
  createdByUserId: string;
  runtimeMode?: ProjectCanvasRuntimeMode;
  entryPath?: string | null;
  devServer?: Record<string, unknown> | null;
}): Promise<ProjectCanvasSummary> {
  const name = input.name.trim() || "Interactive Canvas";
  const slug = await createAvailableCanvasSlug(input.environmentId, name);
  const rootPath = `canvases/${slug}`;
  const entryPath = normalizeEntryPath(input.entryPath);
  const runtimeMode = normalizeRuntimeMode(input.runtimeMode);
  const devServer = normalizeDevServerConfig(input.devServer);

  await ensureProjectCanvasFiles({
    environmentRootPath: input.environmentRootPath,
    name,
    rootPath,
    entryPath,
    runtimeMode,
    devServer
  });

  const result = await query<ProjectCanvasRow>(
    `INSERT INTO project_canvases (
       workspace_id,
       environment_id,
       name,
       slug,
       root_path,
       entry_path,
       runtime_mode,
       dev_server_json,
       created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     RETURNING id,
               workspace_id,
               environment_id,
               name,
               slug,
               root_path,
               entry_path,
               runtime_mode,
               dev_server_json,
               created_by,
               last_task_id,
               created_at,
               updated_at`,
    [
      input.workspaceId,
      input.environmentId,
      name,
      slug,
      rootPath,
      entryPath,
      runtimeMode,
      JSON.stringify(devServer),
      input.createdByUserId
    ]
  );

  return toSummary(result.rows[0]);
}

export async function updateProjectCanvas(input: {
  canvasId: string;
  name?: string;
  entryPath?: string | null;
  runtimeMode?: ProjectCanvasRuntimeMode;
  devServer?: Record<string, unknown> | null;
}): Promise<ProjectCanvasSummary> {
  const current = await getProjectCanvas(input.canvasId);
  if (!current) {
    throw new Error("Canvas not found");
  }

  const nextName = input.name?.trim() || current.name;
  const nextEntryPath = input.entryPath !== undefined ? normalizeEntryPath(input.entryPath) : current.entryPath;
  const nextRuntimeMode = input.runtimeMode ? normalizeRuntimeMode(input.runtimeMode) : current.runtimeMode;
  const nextDevServer = input.devServer !== undefined ? normalizeDevServerConfig(input.devServer) : current.devServer;

  const result = await query<ProjectCanvasRow>(
    `UPDATE project_canvases
        SET name = $2,
            entry_path = $3,
            runtime_mode = $4,
            dev_server_json = $5::jsonb,
            updated_at = now()
      WHERE id = $1
      RETURNING id,
                workspace_id,
                environment_id,
                name,
                slug,
                root_path,
                entry_path,
                runtime_mode,
                dev_server_json,
                created_by,
                last_task_id,
                created_at,
                updated_at`,
    [
      input.canvasId,
      nextName,
      nextEntryPath,
      nextRuntimeMode,
      JSON.stringify(nextDevServer)
    ]
  );

  return toSummary(result.rows[0]);
}

export async function touchProjectCanvasTask(input: {
  canvasId: string;
  taskId: string;
}): Promise<void> {
  await query(
    `UPDATE project_canvases
        SET last_task_id = $2,
            updated_at = now()
      WHERE id = $1`,
    [input.canvasId, input.taskId]
  );
}

export async function assertCanvasBelongsToProject(input: {
  canvasId: string;
  workspaceId: string;
  environmentId: string;
}): Promise<ProjectCanvasSummary> {
  const canvas = await getProjectCanvas(input.canvasId);
  if (!canvas || canvas.workspaceId !== input.workspaceId || canvas.projectId !== input.environmentId) {
    throw new Error("Canvas not found");
  }

  return canvas;
}

export async function resolveCanvasFile(input: {
  environmentRootPath: string;
  canvas: ProjectCanvasSummary;
  requestedPath?: string | null;
}): Promise<{
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
}> {
  const canvasDir = await resolveRealPathWithinRoot(input.environmentRootPath, input.canvas.rootPath);
  const requestedPath = input.requestedPath?.trim() || input.canvas.entryPath;
  const target = await resolveRealPathWithinRoot(canvasDir.absolutePath, requestedPath);
  const stats = await fs.lstat(target.absolutePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error("File not found");
  }

  return {
    absolutePath: target.absolutePath,
    relativePath: target.relativePath,
    sizeBytes: stats.size
  };
}
