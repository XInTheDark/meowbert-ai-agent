import fs from "node:fs/promises";
import path from "node:path";
import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";
import { resolveTaskInlineFile } from "../tasks/task-inline-files.js";
import { createProjectCanvas, type ProjectCanvasSummary } from "./project-canvases.js";

function defaultCanvasName(relativePath: string): string {
  const segments = relativePath.split("/").filter(Boolean);
  const folder = segments.length > 1 ? segments[segments.length - 2] : null;
  return folder ?? path.basename(relativePath, path.extname(relativePath));
}

/**
 * Copies a canvas page a task wrote into a new project canvas. The page's own folder comes along
 * so its styles and scripts keep working; a page at the task root is copied on its own, since
 * the root holds the whole task.
 */
export async function copyTaskCanvasToProject(input: {
  taskId: string;
  taskEnvironmentId: string;
  relativePath: string;
  name: string | null;
  createdByUserId: string;
  project: { id: string; workspace_id: string; root_path: string };
}): Promise<ProjectCanvasSummary> {
  const file = await resolveTaskInlineFile(input.taskId, input.relativePath);
  const isAtTaskRoot = !file.relativePath.includes("/");
  const projectRoot = await ensureEnvironmentStorageRoot(input.project);
  const canvas = await createProjectCanvas({
    workspaceId: input.project.workspace_id,
    environmentId: input.project.id,
    environmentRootPath: projectRoot,
    name: input.name?.trim() || defaultCanvasName(file.relativePath),
    createdByUserId: input.createdByUserId,
    entryPath: path.basename(file.relativePath)
  });

  const target = path.resolve(projectRoot, canvas.rootPath);
  if (isAtTaskRoot) {
    await fs.copyFile(file.absolutePath, path.join(target, path.basename(file.absolutePath)));
  } else {
    await fs.cp(path.dirname(file.absolutePath), target, { recursive: true, dereference: false, verbatimSymlinks: true });
  }

  // Shown in the source task's canvas list only when the task can preview it from its own project.
  if (input.project.id === input.taskEnvironmentId) {
    await query(`UPDATE project_canvases SET last_task_id = $2 WHERE id = $1`, [canvas.id, input.taskId]);
    return { ...canvas, lastTaskId: input.taskId };
  }
  return canvas;
}
