import type { WorkspaceFileHost } from "./workspace-file-host.js";

/** One policy for file-dependent server workflows, UI surfaces, and agent tools. */
export function workspaceFileFeatures(fileHost: WorkspaceFileHost) {
  const server = fileHost.kind === "server";
  return {
    serverFiles: server,
    projectMaster: server,
    memorySearch: server,
    memorySynthesis: server,
    canvases: server,
    terminalSessions: server,
    linkedSources: server,
    inboundAttachments: server,
    forkFiles: server,
    storageManagement: server,
    members: server
  };
}

export class WorkspaceFilesOnDeviceError extends Error {
  readonly statusCode = 409;
  readonly code = "WORKSPACE_FILES_ON_DEVICE";
  constructor(readonly workspaceId: string) {
    super("Workspace files are on its device. Open this workspace in Meowbert Desktop on that device.");
    this.name = "WorkspaceFilesOnDeviceError";
  }
}

export function assertServerWorkspaceFiles(workspaceId: string, fileHost: WorkspaceFileHost): void {
  if (!workspaceFileFeatures(fileHost).serverFiles) throw new WorkspaceFilesOnDeviceError(workspaceId);
}
