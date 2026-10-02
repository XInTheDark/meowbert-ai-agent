import {
  buildBatchDownloadUrl,
  buildDownloadUrl,
  buildWorkspaceBatchDownloadUrl,
  buildWorkspaceDownloadUrl
} from "../../lib/utils";

// Where a file browser reads and writes: the workspace's shared files or one project's files.
export interface FileScope {
  key: string;
  filesApiPath: string;
  archiveName: string;
  downloadUrl: (relativePath: string) => string;
  batchDownloadUrl: (relativePaths: string[], currentDirectory: string) => string;
}

export function projectFileScope(projectId: string): FileScope {
  return {
    key: `project:${projectId}`,
    filesApiPath: `/api/projects/${projectId}/files`,
    archiveName: "project-files",
    downloadUrl: (relativePath) => buildDownloadUrl(projectId, relativePath),
    batchDownloadUrl: (relativePaths, currentDirectory) => buildBatchDownloadUrl(projectId, relativePaths, currentDirectory)
  };
}

export function workspaceFileScope(workspaceId: string): FileScope {
  return {
    key: `workspace:${workspaceId}`,
    filesApiPath: `/api/workspaces/${workspaceId}/files`,
    archiveName: "workspace-files",
    downloadUrl: (relativePath) => buildWorkspaceDownloadUrl(workspaceId, relativePath),
    batchDownloadUrl: (relativePaths, currentDirectory) => buildWorkspaceBatchDownloadUrl(workspaceId, relativePaths, currentDirectory)
  };
}

// The route for browsing the same folder in another scope ("workspace" or a project id).
export function fileScopeRoute(workspaceId: string, scopeValue: string, cwd: string): string {
  const query = cwd ? `?path=${encodeURIComponent(cwd)}` : "";
  return scopeValue === "workspace"
    ? `/app/${workspaceId}/files${query}`
    : `/app/${workspaceId}/projects/${scopeValue}/files${query}`;
}
