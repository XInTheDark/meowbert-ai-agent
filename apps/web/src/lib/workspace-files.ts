import { workspaceFilesScope, type WorkspaceFileLocation, type WorkspaceFilesRequest } from "@meowbert/shared/workspace-files";

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;
/** One file adapter for every web file surface: authenticated HTTP or native desktop IPC. */
export function createWorkspaceFiles(request: Request) {
  const location = async (path: string): Promise<WorkspaceFileLocation | null> => {
    const scope = workspaceFilesScope(path);
    return scope ? request<WorkspaceFileLocation>("GET", "/api/workspace-files/location?" + new URLSearchParams(scope)) : null;
  };
  return {
    resolveLocation: location,
    async handle<T>(input: WorkspaceFilesRequest): Promise<{ handled: boolean; value?: T }> {
      const resolved = await location(input.path);
      if (!resolved || resolved.fileHost.kind === "server") return { handled: false };
      const desktop = window.meowbertDesktop;
      if (!desktop?.workspaceFiles) throw new Error("Files are on " + (resolved.deviceName ?? "the workspace device") + ". Open Meowbert Desktop on that device.");
      return { handled: true, value: await desktop.workspaceFiles(input) as T };
    }
  };
}
