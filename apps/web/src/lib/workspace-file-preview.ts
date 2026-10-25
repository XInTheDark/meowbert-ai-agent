import { createApiClient } from "./api";
import { createWorkspaceFiles } from "./workspace-files";

export async function fetchWorkspaceFilePreview(url: string, token: string, signal: AbortSignal): Promise<Response> {
  const parsed = new URL(url, window.location.href);
  const api = createApiClient(token);
  const files = createWorkspaceFiles((_method, path) => api.get(path));
  const result = await files.handle<{ dataBase64: string }>({ method: "GET", path: parsed.pathname + parsed.search });
  signal.throwIfAborted();
  if (result.handled) {
    const bytes = Uint8Array.from(atob(result.value!.dataBase64), (character) => character.charCodeAt(0));
    return new Response(bytes);
  }
  return fetch(url, { headers: { authorization: "Bearer " + token }, signal });
}
