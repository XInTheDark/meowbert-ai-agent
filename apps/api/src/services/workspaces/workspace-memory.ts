import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MEMORY_ENABLED,
  MAX_PROJECT_SUGGESTED_ACTIONS,
  PROJECT_MEMORY_ACTIONS_FILENAME,
  PROJECT_MEMORY_PARENT_DIRNAME,
  type ProjectSuggestedAction,
  WORKSPACE_MEMORY_DIRNAME,
  WORKSPACE_MEMORY_MAIN_FILENAME,
  createDefaultProjectMemoryMainFileContent,
  createDefaultProjectSuggestedActions,
  createDefaultWorkspaceMemoryMainFileContent
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { ensureWorkspaceStorageRoot } from "./workspace-storage.js";

export async function isWorkspaceMemoryEnabled(workspaceId: string): Promise<boolean> {
  const result = await query<{ memory_enabled: boolean }>(
    `SELECT memory_enabled
       FROM workspace_settings
      WHERE workspace_id = $1`,
    [workspaceId]
  );

  return result.rows[0]?.memory_enabled ?? DEFAULT_MEMORY_ENABLED;
}

export async function ensureWorkspaceMemoryFiles(workspaceRoot: string): Promise<{
  memoryDir: string;
  mainFilePath: string;
}> {
  const memoryDir = path.resolve(workspaceRoot, WORKSPACE_MEMORY_DIRNAME);
  const mainFilePath = path.resolve(memoryDir, WORKSPACE_MEMORY_MAIN_FILENAME);
  await fsPromises.mkdir(memoryDir, { recursive: true });

  const existing = await fsPromises.readFile(mainFilePath, "utf8").catch(() => null);
  if (existing === null) {
    await fsPromises.writeFile(mainFilePath, createDefaultWorkspaceMemoryMainFileContent(), "utf8");
  }

  return { memoryDir, mainFilePath };
}

export async function ensureProjectMemoryFiles(input: {
  workspaceRoot: string;
  projectId: string;
  projectName?: string | null;
}): Promise<{
  projectMemoryDir: string;
  mainFilePath: string;
  actionsFilePath: string;
}> {
  const memoryDir = path.resolve(input.workspaceRoot, WORKSPACE_MEMORY_DIRNAME);
  const projectMemoryDir = path.resolve(memoryDir, PROJECT_MEMORY_PARENT_DIRNAME, input.projectId);
  const mainFilePath = path.resolve(projectMemoryDir, WORKSPACE_MEMORY_MAIN_FILENAME);
  const actionsFilePath = path.resolve(projectMemoryDir, PROJECT_MEMORY_ACTIONS_FILENAME);
  await fsPromises.mkdir(projectMemoryDir, { recursive: true });

  const existing = await fsPromises.readFile(mainFilePath, "utf8").catch(() => null);
  if (existing === null) {
    await fsPromises.writeFile(mainFilePath, createDefaultProjectMemoryMainFileContent(input.projectName), "utf8");
  }

  const existingActions = await fsPromises.readFile(actionsFilePath, "utf8").catch(() => null);
  if (existingActions === null) {
    await fsPromises.writeFile(
      actionsFilePath,
      JSON.stringify(createDefaultProjectSuggestedActions(), null, 2),
      "utf8"
    );
  }

  return { projectMemoryDir, mainFilePath, actionsFilePath };
}

export async function loadProjectSuggestedActions(input: {
  workspaceRoot: string;
  projectId: string;
}): Promise<ProjectSuggestedAction[]> {
  const memoryDir = path.resolve(input.workspaceRoot, WORKSPACE_MEMORY_DIRNAME);
  const actionsFilePath = path.resolve(memoryDir, PROJECT_MEMORY_PARENT_DIRNAME, input.projectId, PROJECT_MEMORY_ACTIONS_FILENAME);

  try {
    const raw = await fsPromises.readFile(actionsFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .filter(
          (item): item is ProjectSuggestedAction =>
            typeof item === "object" && item !== null && typeof item.label === "string" && typeof item.prompt === "string"
        )
        .slice(0, MAX_PROJECT_SUGGESTED_ACTIONS);
    }
  } catch {
    // If not found or invalid json, return defaults
  }

  return createDefaultProjectSuggestedActions();
}

export async function ensureProjectMemoryFilesForWorkspace(input: {
  workspaceId: string;
  projectId: string;
  projectName?: string | null;
}): Promise<{
  projectMemoryDir: string;
  mainFilePath: string;
  actionsFilePath: string;
} | null> {
  const result = await query<{
    id: string;
    root_path: string;
    memory_enabled: boolean;
  }>(
    `SELECT w.id,
            w.root_path,
            COALESCE(ws.memory_enabled, ${DEFAULT_MEMORY_ENABLED}) AS memory_enabled
       FROM workspaces w
       LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
      WHERE w.id = $1`,
    [input.workspaceId]
  );

  const workspace = result.rows[0];
  if (!workspace || !workspace.memory_enabled) {
    return null;
  }

  const workspaceRoot = await ensureWorkspaceStorageRoot(workspace);
  await ensureWorkspaceMemoryFiles(workspaceRoot);
  return ensureProjectMemoryFiles({
    workspaceRoot,
    projectId: input.projectId,
    projectName: input.projectName
  });
}

export function buildWorkspaceMemoryEnvVars(
  workspaceRoot: string,
  memoryEnabled: boolean,
  projectId?: string | null
): Record<string, string> {
  if (!memoryEnabled) {
    return {};
  }

  const memoryDir = path.resolve(workspaceRoot, WORKSPACE_MEMORY_DIRNAME);
  const envVars: Record<string, string> = {
    MEMORY_DIR: memoryDir,
    MEOWBERT_MEMORY_DIR: memoryDir
  };

  if (projectId && projectId.trim().length > 0) {
    const projectMemoryDir = path.resolve(memoryDir, PROJECT_MEMORY_PARENT_DIRNAME, projectId);
    envVars.PROJECT_MEMORY_DIR = projectMemoryDir;
    envVars.MEOWBERT_PROJECT_MEMORY_DIR = projectMemoryDir;
  }

  return envVars;
}
