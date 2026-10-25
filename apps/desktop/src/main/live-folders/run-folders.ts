import type { LocalLiveFolder, LocalLiveFolderConfig } from "@meowbert/shared";
import type { RunBootstrap } from "@meowbert/run-executor/agent/ports/run-bootstrap";
import { StorageNotReadyError } from "../storage/inputs";
import type { DesktopLocalExecutorOptions } from "../executor/local-executor";

export async function prepareRunLiveFolders(input: {
  options: DesktopLocalExecutorOptions; bootstrap: RunBootstrap; runId: string; token: string; consumer: string;
  host: boolean; signal: AbortSignal;
}): Promise<RunBootstrap["liveSyncFiles"]> {
  const files = input.bootstrap.liveSyncFiles ?? [];
  const links = files.filter((file) => file.provider === "google-drive" && file.linkKind === "folder");
  if (!links.length) return files;
  const { options } = input;
  if (process.platform !== "darwin") throw new StorageNotReadyError("Live Drive folders require macOS.");
  if (!options.liveDriveEnabled || !options.liveFolders) throw new StorageNotReadyError("Enable live Drive folders in Local Execution settings.");
  async function request<T>(route: string, body?: unknown): Promise<T> {
    const response = await (options.fetch ?? fetch)(options.apiBaseUrl + "/api/runs/" + input.runId + route, {
      method: body === undefined ? "GET" : "POST", headers: { authorization: "Bearer " + input.token, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([input.signal, AbortSignal.timeout(30_000)])
    });
    if (!response.ok) throw new StorageNotReadyError("Live Drive folders are unavailable. Check ownership, Google Drive access, and the device connection.");
    return await response.json() as T;
  }
  const { folders } = await request<{ folders: LocalLiveFolder[] }>("/live-folders");
  const paths = new Map<string, string>();
  for (const link of links) {
    input.signal.throwIfAborted();
    const folder = folders.find((entry) => entry.linkId === link.id);
    if (!folder) throw new StorageNotReadyError("A linked Drive folder is no longer available for this task.");
    if (!await options.onLiveFolderConsent?.(folder)) throw new StorageNotReadyError("Waiting for live Google Drive consent. Retry Local Execution after allowing access.");
    input.signal.throwIfAborted();
    const config = await request<LocalLiveFolderConfig>("/live-folders/" + folder.linkId + "/rclone-config", { connectionId: folder.connectionId, consent: true });
    if (config.linkId !== folder.linkId || config.connectionId !== folder.connectionId) throw new Error("The live Drive connection changed.");
    try { paths.set(link.id, await options.liveFolders.acquire(config, input.consumer, input.signal)); }
    catch { throw new StorageNotReadyError("The live Drive folder could not be mounted. Retry Local Execution after checking macOS NFS access."); }
  }
  return files.map((file) => paths.has(file.id) ? { ...file, taskRelativePath: paths.get(file.id)! } : file);
}
