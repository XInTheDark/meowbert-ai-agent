import path from "node:path";
import type { WorkspaceFilesRequest } from "@meowbert/shared";
import type { deviceFileContext } from "./service";
import { resolveDevicePath } from "./roots";
import { deleteDeviceFiles, listDeviceDirectory } from "./file-operations";

interface FolderLink { id: string; localRelativePath: string; remoteName: string; remoteWebUrl: string | null }
type Context = NonNullable<Awaited<ReturnType<typeof deviceFileContext>>>;
type DirectoryEntry = Omit<Awaited<ReturnType<typeof listDeviceDirectory>>["items"][number], "createdAt" | "modifiedAt"> & { createdAt: string | null; modifiedAt: string | null; liveSync?: FolderLink & { provider: string; linkKind: string; lastPulledAt: null; lastPushedAt: null; lastSyncError: null } };
const normalize = (value: string) => path.posix.normalize(value.replace(/\\/g, "/")).replace(/\/$/, "").replace(/^\.$/, "");

function visibleLinks(folders: FolderLink[], taskRoot: string | null): FolderLink[] {
  return folders.filter((folder) => !taskRoot || folder.localRelativePath.startsWith(taskRoot + "/"))
    .map((folder) => ({ ...folder, localRelativePath: taskRoot ? folder.localRelativePath.slice(taskRoot.length + 1) : folder.localRelativePath }));
}

async function listFolders(context: Context, requested: string, folders: FolderLink[]) {
  const cwd = normalize(requested || ".");
  const children = folders.filter((folder) => !cwd || folder.localRelativePath.startsWith(cwd + "/"));
  const listing = await listDeviceDirectory(context.root, requested).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT" || !children.length) throw error;
    return { cwd, parentPath: cwd ? path.posix.dirname(cwd).replace(/^\.$/, "") : null, items: [] };
  });
  const items = new Map<string, DirectoryEntry>(listing.items.map((item) => [item.relativePath, item]));
  for (const folder of children) {
    const suffix = folder.localRelativePath.slice(cwd ? cwd.length + 1 : 0);
    const name = suffix.split("/")[0];
    const relativePath = cwd ? cwd + "/" + name : name;
    if (items.has(relativePath)) continue;
    items.set(relativePath, { name, relativePath, kind: "directory", sizeBytes: null, createdAt: null, modifiedAt: null,
      ...(relativePath === folder.localRelativePath ? { liveSync: { ...folder, provider: "google-drive", linkKind: "folder",
        lastPulledAt: null, lastPushedAt: null, lastSyncError: null } } : {}) });
  }
  return { ...listing, items: [...items.values()].sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name)) };
}

/** Device links are metadata, never symlinks into a run-owned remote mount. */
export async function handleDeviceLiveFolders(context: Context, request: WorkspaceFilesRequest) {
  if (!context.location.projectId || !context.url.pathname.includes("/files")) return { handled: false };
  const base = "/api/projects/" + context.location.projectId + "/live-drive-folders";
  const response = await context.api.request<{ folders: FolderLink[] }>(base);
  const folders = visibleLinks(response.folders, context.location.taskRootPath);
  if (!folders.length) return { handled: false };
  const requested = context.url.searchParams.get("path") ?? "";
  await resolveDevicePath(context.root, requested);
  if (request.method === "POST" && context.url.pathname.endsWith("/delete")) {
    const body = request.body as { paths?: unknown } | undefined;
    if (!Array.isArray(body?.paths) || !body.paths.every((value): value is string => typeof value === "string")) throw new Error("Select files to delete.");
    for (const value of body.paths) {
      await resolveDevicePath(context.root, value);
      if (!normalize(value) || path.basename(value) === ".meowbert-workspace.json") throw new Error("The workspace root and marker cannot be deleted.");
    }
    const paths = body.paths.map(normalize);
    const linked = folders.filter((folder) => paths.some((value) => folder.localRelativePath === value || folder.localRelativePath.startsWith(value + "/")));
    if (paths.some((value) => folders.some((folder) => value.startsWith(folder.localRelativePath + "/")))) throw new Error("Remove the linked folder itself to unlink it.");
    if (linked.length) await context.api.request(base + "/unlink", "POST", { paths: linked.map((folder) =>
      context.location.taskRootPath ? context.location.taskRootPath + "/" + folder.localRelativePath : folder.localRelativePath) });
    return { handled: true, value: await deleteDeviceFiles(context.root, paths) };
  }
  const name = request.file?.name ?? (request.body as { name?: string } | undefined)?.name;
  const target = normalize(request.method === "POST" && name ? path.posix.join(requested, name) : requested);
  if (folders.some((folder) => target === folder.localRelativePath || target.startsWith(folder.localRelativePath + "/"))) {
    throw new Error("Browse this folder in Google Drive. Its files are mounted only while a local host task runs.");
  }
  if (request.method === "GET" && context.url.pathname.endsWith("/files")) return { handled: true, value: await listFolders(context, requested, folders) };
  return { handled: false };
}
