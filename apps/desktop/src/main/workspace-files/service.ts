import fs from "node:fs/promises";
import { workspaceFilesScope, workspaceFilesRequestSchema, deviceWorkspaceProjectPath, createDefaultProjectSuggestedActions,
  type WorkspaceFileLocation, type WorkspaceFilesRequest } from "@meowbert/shared";
import { readWorkspaceMemoryMainFile, readProjectMemoryMainFile } from "@meowbert/run-executor/memory/main-files";
import { readBootstrapData } from "../state";
import { createDeviceApi } from "../executor/device-api";
import { resolveDevicePath, verifyDeviceWorkspace } from "./roots";
import { listDeviceDirectory, previewDeviceFile, writeDeviceFile, deleteDeviceFiles } from "./file-operations";
import { issueDeviceFileTicket } from "./inline-tickets";

export async function deviceFileContext(requestPath: string) {
  const url = new URL(requestPath, "http://workspace.invalid");
  const scope = workspaceFilesScope(url.pathname);
  if (!scope) return null;
  const bootstrap = await readBootstrapData(); const settings = bootstrap.localExecutionSettings;
  if (!bootstrap.token || !settings.serverBaseUrl) throw new Error("Sign in to the workspace server.");
  if (url.hostname !== "workspace.invalid" && url.origin !== new URL(settings.serverBaseUrl).origin) throw new Error("The file belongs to another server.");
  const api = createDeviceApi({ apiBaseUrl: settings.serverBaseUrl, token: bootstrap.token }, new AbortController().signal);
  const location = await api.request<WorkspaceFileLocation>("/api/workspace-files/location?" + new URLSearchParams(scope));
  if (location.fileHost.kind === "server") return null;
  if (location.fileHost.deviceId !== settings.deviceId) throw new Error("Files are on " + (location.deviceName ?? "another device") + ".");
  const selectedRoot = settings.workspaceRoots?.[location.workspaceId];
  if (!selectedRoot) throw new Error("Relink this workspace folder in Local Execution settings.");
  const workspaceRoot = await verifyDeviceWorkspace(selectedRoot, location.workspaceId);
  let root = workspaceRoot;
  if (location.projectId) {
    root = await resolveDevicePath(workspaceRoot, deviceWorkspaceProjectPath(location.projectId));
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(await resolveDevicePath(root, "context"), { recursive: true });
  }
  if (location.taskRootPath) {
    root = await resolveDevicePath(root, location.taskRootPath);
    await fs.mkdir(root, { recursive: true });
  }
  return { location, workspaceRoot, root, api, settings, url };
}

async function readDeviceMemory(context: NonNullable<Awaited<ReturnType<typeof deviceFileContext>>>) {
  if (!context.location.memoryEnabled) return { enabled: false, workspace: null, project: null, actions: createDefaultProjectSuggestedActions(), latestRefresh: null, recentRefreshes: [] };
  const projectId = context.url.searchParams.get("projectId");
  if (projectId) {
    const location = await context.api.request<WorkspaceFileLocation>("/api/workspace-files/location?projectId=" + encodeURIComponent(projectId));
    if (location.workspaceId !== context.location.workspaceId) throw new Error("Project is not in this workspace.");
  }
  const workspace = await readWorkspaceMemoryMainFile(context.workspaceRoot);
  const project = projectId ? await readProjectMemoryMainFile({ workspaceRoot: context.workspaceRoot, projectId }) : null;
  return { enabled: true, suggestedActionsEnabled: false, workspace, project, actions: createDefaultProjectSuggestedActions(), latestRefresh: null, recentRefreshes: [] };
}

export async function requestDeviceWorkspaceFiles(input: WorkspaceFilesRequest): Promise<unknown> {
  const request = workspaceFilesRequestSchema.parse(input);
  const context = await deviceFileContext(request.path);
  if (!context) throw new Error("These files are hosted by the server.");
  const { root, url, api, settings, location } = context;
  const requested = url.searchParams.get("path") ?? "";
  if (url.pathname.endsWith("/memory") && request.method === "GET") return readDeviceMemory(context);
  if (url.pathname.endsWith("/suggested-actions")) return { enabled: false, actions: createDefaultProjectSuggestedActions() };
  if (url.pathname.endsWith("/storage")) return { storage: null };
  if (url.pathname.endsWith("/inline-files/ticket") && request.method === "POST") {
    return issueDeviceFileTicket(settings.serverBaseUrl!, workspaceFilesScope(url.pathname)!.taskId!);
  }
  if (url.pathname.endsWith("/files") && request.method === "GET") return listDeviceDirectory(root, requested);
  if (url.pathname.endsWith("/content") && request.method === "GET") return previewDeviceFile(root, requested);
  if (url.pathname.endsWith("/files/download") && request.method === "GET") {
    const target = await resolveDevicePath(root, requested);
    if (!(await fs.stat(target)).isFile()) throw new Error("File not found.");
    return { dataBase64: (await fs.readFile(target)).toString("base64") };
  }
  if (request.method === "POST" && /\/(upload|text)$/.test(url.pathname)) {
    const file = await writeDeviceFile(root, request, requested);
    if (location.projectId) await api.request("/api/projects/" + location.projectId + "/device-inputs", "POST", {
      deviceId: settings.deviceId, name: file.name, relativePath: file.relativePath, sizeBytes: file.sizeBytes, sha256: file.sha256,
      createdAt: file.createdAt, modifiedAt: file.modifiedAt
    });
    return { file };
  }
  if (url.pathname.endsWith("/delete") && request.method === "POST") {
    const body = request.body as { paths?: unknown };
    if (!Array.isArray(body?.paths) || !body.paths.every((value) => typeof value === "string")) throw new Error("Select files to delete.");
    return deleteDeviceFiles(root, body.paths);
  }
  throw new Error("This operation is unavailable for a device workspace.");
}
