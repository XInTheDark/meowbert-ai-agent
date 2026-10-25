import { z } from "zod";
import type { WorkspaceFileHost } from "./workspace-file-host.js";

export const workspaceFilesRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE"]),
  path: z.string().startsWith("/api/").max(8192),
  body: z.unknown().optional(),
  file: z.object({ name: z.string().min(1).max(255), dataBase64: z.string(), type: z.string() }).optional()
}).strict();
export type WorkspaceFilesRequest = z.infer<typeof workspaceFilesRequestSchema>;

export interface WorkspaceFileLocation {
  workspaceId: string;
  fileHost: WorkspaceFileHost;
  deviceName: string | null;
  projectId: string | null;
  projectName: string | null;
  taskRootPath: string | null;
  memoryEnabled: boolean;
}

/** Only file operations use the adapter. Metadata stays on the authenticated API. */
export function workspaceFilesScope(url: string): { workspaceId?: string; projectId?: string; taskId?: string } | null {
  const pathname = new URL(url, "http://workspace.invalid").pathname;
  const match = pathname.match(/^\/api\/(workspaces|projects|environments|tasks)\/([a-f0-9-]{36})\/(.+)$/i);
  if (!match) return null;
  const [, kind, id, suffix] = match;
  const file = suffix === "files" || suffix.startsWith("files/") || suffix === "memory" || suffix.startsWith("inline-files")
    || suffix === "context" || suffix.startsWith("context/") || suffix.endsWith("/suggested-actions");
  if (!file) return null;
  return kind === "workspaces" ? { workspaceId: id } : kind === "tasks" ? { taskId: id } : { projectId: id };
}

export function deviceWorkspaceProjectPath(projectId: string): string {
  if (!z.string().uuid().safeParse(projectId).success) throw new Error("Invalid project id.");
  return "projects/" + projectId;
}
