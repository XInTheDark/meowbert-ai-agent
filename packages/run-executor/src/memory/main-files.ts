import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_MEMORY_PARENT_DIRNAME,
  WORKSPACE_MEMORY_DIRNAME,
  WORKSPACE_MEMORY_MAIN_FILENAME,
  createDefaultProjectMemoryMainFileContent,
  createDefaultWorkspaceMemoryMainFileContent
} from "@meowbert/shared";

// The memory files a run reads into its prompt and points the agent at. Plain files under the
// workspace root, so an executor reads them from its own view of the storage.

export const MEMORY_MAIN_FILE_PROMPT_MAX_CHARS = 12_000;

export interface MemoryMainFile {
  path: string;
  content: string;
  truncated: boolean;
}

export function getWorkspaceMemoryDir(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, WORKSPACE_MEMORY_DIRNAME);
}

function getWorkspaceMemoryMainFilePath(memoryDir: string): string {
  return path.resolve(memoryDir, WORKSPACE_MEMORY_MAIN_FILENAME);
}

async function ensureWorkspaceMemoryMainFile(memoryDir: string): Promise<string> {
  const mainFilePath = getWorkspaceMemoryMainFilePath(memoryDir);
  const existing = await fsPromises.readFile(mainFilePath, "utf8").catch(() => null);
  if (existing === null) {
    await fsPromises.writeFile(mainFilePath, createDefaultWorkspaceMemoryMainFileContent(), "utf8");
  }
  return mainFilePath;
}

export function getProjectMemoryDir(memoryDir: string, projectId: string): string {
  return path.resolve(memoryDir, PROJECT_MEMORY_PARENT_DIRNAME, projectId);
}

async function ensureProjectMemoryMainFile(
  projectMemoryDir: string,
  projectName?: string | null
): Promise<string> {
  const mainFilePath = path.resolve(projectMemoryDir, WORKSPACE_MEMORY_MAIN_FILENAME);
  const existing = await fsPromises.readFile(mainFilePath, "utf8").catch(() => null);
  if (existing === null) {
    await fsPromises.writeFile(mainFilePath, createDefaultProjectMemoryMainFileContent(projectName), "utf8");
  }
  return mainFilePath;
}

async function readMemoryMainFile(mainFilePath: string): Promise<MemoryMainFile> {
  const content = await fsPromises.readFile(mainFilePath, "utf8").catch(() => "");
  if (content.length <= MEMORY_MAIN_FILE_PROMPT_MAX_CHARS) {
    return {
      path: mainFilePath,
      content,
      truncated: false
    };
  }

  return {
    path: mainFilePath,
    content: `${content.slice(0, MEMORY_MAIN_FILE_PROMPT_MAX_CHARS)}

[Truncated for task prompt injection.]`,
    truncated: true
  };
}

export async function readWorkspaceMemoryMainFile(workspaceRoot: string): Promise<MemoryMainFile> {
  const memoryDir = getWorkspaceMemoryDir(workspaceRoot);
  await fsPromises.mkdir(memoryDir, { recursive: true });
  const mainFilePath = await ensureWorkspaceMemoryMainFile(memoryDir);
  return readMemoryMainFile(mainFilePath);
}

export async function readProjectMemoryMainFile(input: {
  workspaceRoot: string;
  projectId: string;
  projectName?: string | null;
}): Promise<MemoryMainFile> {
  const memoryDir = getWorkspaceMemoryDir(input.workspaceRoot);
  const projectMemoryDir = getProjectMemoryDir(memoryDir, input.projectId);
  await fsPromises.mkdir(projectMemoryDir, { recursive: true });
  const mainFilePath = await ensureProjectMemoryMainFile(projectMemoryDir, input.projectName);
  return readMemoryMainFile(mainFilePath);
}

export function buildWorkspaceMemoryEnvVars(
  workspaceRoot: string,
  memoryEnabled: boolean,
  projectId?: string | null
): Record<string, string> {
  if (!memoryEnabled) {
    return {};
  }

  const memoryDir = getWorkspaceMemoryDir(workspaceRoot);
  const envVars: Record<string, string> = {
    MEMORY_DIR: memoryDir,
    MEOWBERT_MEMORY_DIR: memoryDir
  };

  if (projectId && projectId.trim().length > 0) {
    const projectMemoryDir = getProjectMemoryDir(memoryDir, projectId);
    envVars.PROJECT_MEMORY_DIR = projectMemoryDir;
    envVars.MEOWBERT_PROJECT_MEMORY_DIR = projectMemoryDir;
  }

  return envVars;
}

export async function ensureWorkspaceMemoryDir(workspaceRoot: string): Promise<string> {
  const memoryDir = getWorkspaceMemoryDir(workspaceRoot);
  await fsPromises.mkdir(memoryDir, { recursive: true });
  await ensureWorkspaceMemoryMainFile(memoryDir);
  return memoryDir;
}

export async function ensureProjectMemoryDir(input: {
  workspaceRoot: string;
  projectId: string;
  projectName?: string | null;
}): Promise<string> {
  const memoryDir = getWorkspaceMemoryDir(input.workspaceRoot);
  const projectMemoryDir = getProjectMemoryDir(memoryDir, input.projectId);
  await fsPromises.mkdir(projectMemoryDir, { recursive: true });
  await ensureProjectMemoryMainFile(projectMemoryDir, input.projectName);
  return projectMemoryDir;
}
