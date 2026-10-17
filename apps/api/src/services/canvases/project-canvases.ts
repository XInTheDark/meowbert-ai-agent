import fs from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_CANVASES_DIR,
  listCanvasSlugCandidates,
  normalizeCanvasEntryPath
} from "@meowbert/shared";
import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";
import { query } from "../../lib/db.js";

export type ProjectCanvasIntent = "create" | "update" | "view";

export interface ProjectCanvasRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  name: string;
  slug: string;
  root_path: string;
  entry_path: string;
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
  lastTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

const CANVAS_COLUMNS = `id,
            workspace_id,
            environment_id,
            name,
            slug,
            root_path,
            entry_path,
            created_by,
            last_task_id,
            created_at,
            updated_at`;

function toSummary(row: ProjectCanvasRow): ProjectCanvasSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.environment_id,
    name: row.name,
    slug: row.slug,
    rootPath: row.root_path,
    entryPath: row.entry_path,
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
  for (const slug of listCanvasSlugCandidates(name)) {
    if (!(await slugExists(environmentId, slug))) {
      return slug;
    }
  }

  throw new Error("Too many canvases with similar names");
}

export async function listProjectCanvases(environmentId: string): Promise<ProjectCanvasSummary[]> {
  const result = await query<ProjectCanvasRow>(
    `SELECT ${CANVAS_COLUMNS}
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
    `SELECT ${CANVAS_COLUMNS}
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
  entryPath?: string | null;
}): Promise<ProjectCanvasSummary> {
  const name = input.name.trim() || "Canvas";
  const slug = await createAvailableCanvasSlug(input.environmentId, name);
  const rootPath = `${PROJECT_CANVASES_DIR}/${slug}`;
  await fs.mkdir(path.resolve(input.environmentRootPath, rootPath), { recursive: true });

  const result = await query<ProjectCanvasRow>(
    `INSERT INTO project_canvases (
       workspace_id,
       environment_id,
       name,
       slug,
       root_path,
       entry_path,
       created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${CANVAS_COLUMNS}`,
    [
      input.workspaceId,
      input.environmentId,
      name,
      slug,
      rootPath,
      normalizeCanvasEntryPath(input.entryPath),
      input.createdByUserId
    ]
  );

  return toSummary(result.rows[0]);
}

export async function updateProjectCanvas(input: {
  canvasId: string;
  name?: string;
  entryPath?: string | null;
}): Promise<ProjectCanvasSummary> {
  const current = await getProjectCanvas(input.canvasId);
  if (!current) {
    throw new Error("Canvas not found");
  }

  const result = await query<ProjectCanvasRow>(
    `UPDATE project_canvases
        SET name = $2,
            entry_path = $3,
            updated_at = now()
      WHERE id = $1
      RETURNING ${CANVAS_COLUMNS}`,
    [
      input.canvasId,
      input.name?.trim() || current.name,
      input.entryPath !== undefined ? normalizeCanvasEntryPath(input.entryPath) : current.entryPath
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
