import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export function ensureWorkspaceRoot(workspaceId: string): string {
  const workspacePath = path.resolve(config.runtime.workspacesRoot, workspaceId, "root");
  fs.mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

export function ensureEnvironmentRoot(workspaceId: string, environmentId: string): string {
  const envPath = path.resolve(config.runtime.environmentsRoot, workspaceId, environmentId, "root");
  fs.mkdirSync(envPath, { recursive: true });
  return envPath;
}
