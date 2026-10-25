import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { finished } from "node:stream/promises";
import archiver from "archiver";
import { net, protocol } from "electron";
import { readBootstrapData } from "../state";
import { deviceFileContext } from "./service";
import { resolveDevicePath } from "./roots";
import { verifyDeviceFileTicket } from "./inline-tickets";

export function registerDeviceFileScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: "meowbert-workspace", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

export function registerDeviceFileProtocol(): void {
  protocol.handle("meowbert-workspace", async (request) => {
    try {
      const url = new URL(request.url);
      const [ticket, ...segments] = url.pathname.slice(1).split("/");
      const { localExecutionSettings } = await readBootstrapData();
      if (url.hostname !== "files" || request.method !== "GET") return new Response(null, { status: 403 });
      const requestPath = "/" + segments.join("/");
      const match = requestPath.match(/^\/api\/tasks\/([a-f0-9-]{36})\/inline-files\/device\/(.+)$/i);
      if (!match) return new Response(null, { status: 404 });
      if (!verifyDeviceFileTicket(ticket, localExecutionSettings.serverBaseUrl ?? "", match[1])) return new Response(null, { status: 403 });
      const context = await deviceFileContext(requestPath);
      if (!context) return new Response(null, { status: 404 });
      const target = await resolveDevicePath(context.root, decodeURIComponent(match[2]));
      if (!(await fsPromises.stat(target)).isFile()) return new Response(null, { status: 404 });
      return net.fetch(pathToFileURL(target).href);
    } catch { return new Response(null, { status: 404 }); }
  });
}

/** The user requested these named files; ZIP traversal is confined to that selection. */
export async function downloadDeviceWorkspaceFile(url: string, destination: string): Promise<boolean> {
  const parsed = new URL(url);
  if (!/\/files\/download(?:\/batch)?$/.test(parsed.pathname)) return false;
  const context = await deviceFileContext(url);
  if (!context) return false;
  const requested = parsed.searchParams.getAll("path");
  if (!requested.length) throw new Error("Choose files to download.");
  const targets = await Promise.all(requested.map((entry) => resolveDevicePath(context.root, entry)));
  if (!parsed.pathname.endsWith("/batch")) {
    if (!(await fsPromises.stat(targets[0])).isFile()) throw new Error("File not found.");
    await fsPromises.copyFile(targets[0], destination);
    return true;
  }
  const output = fs.createWriteStream(destination);
  const archive = archiver("zip");
  archive.on("error", (error) => output.destroy(error));
  archive.on("warning", (error) => output.destroy(error));
  archive.pipe(output);
  const completed = finished(output);
  try {
    for (const target of targets) {
      const name = path.basename(target);
      if ((await fsPromises.stat(target)).isDirectory()) archive.directory(target, name);
      else archive.file(target, { name });
    }
    await archive.finalize();
    await completed;
  } catch (error) {
    archive.abort();
    output.destroy();
    await completed.catch(() => undefined);
    throw error;
  }
  return true;
}
