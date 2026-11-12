import { afterEach, describe, expect, it, vi } from "vitest";
import { findGoogleDriveFileInFolder } from "./google-drive-file-lookup.js";

const FOLDER = "application/vnd.google-apps.folder";
const context = { accessToken: "token", headers: {} };

interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  shortcutDetails?: { targetId: string; targetMimeType: string };
}

// Answers folder lookups by name and file lookups by any of the `name = '...'` candidates.
function installFakeDrive(files: FakeDriveFile[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
    const q = new URL(String(input)).searchParams.get("q") ?? "";
    const parentId = /'([^']+)' in parents/.exec(q)?.[1];
    const names = [...q.matchAll(/name = '((?:[^'\\]|\\.)*)'/g)].map((match) => match[1].replace(/\\(.)/g, "$1"));
    const wantsFolder = q.includes(`mimeType = '${FOLDER}'`);
    const matches = files.filter((file) => file.parents.includes(parentId ?? "") && names.includes(file.name)
      && (wantsFolder ? file.mimeType === FOLDER : file.mimeType !== FOLDER));
    return new Response(JSON.stringify({ files: matches }), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("findGoogleDriveFileInFolder", () => {
  const files: FakeDriveFile[] = [
    { id: "f-2024", name: "2024", mimeType: FOLDER, parents: ["root"] },
    { id: "doc-1", name: "Plan", mimeType: "application/vnd.google-apps.document", parents: ["f-2024"] },
    { id: "url-1", name: "Plan.url", mimeType: "text/plain", parents: ["root"] },
    { id: "pdf-1", name: "a/b.pdf", mimeType: "application/pdf", parents: ["root"] },
    { id: "s-1", name: "Shared", mimeType: "application/vnd.google-apps.shortcut", parents: ["root"], shortcutDetails: { targetId: "pdf-9", targetMimeType: "application/pdf" } }
  ];

  it("maps a mounted `.url` entry to the native Google file", async () => {
    installFakeDrive(files);
    await expect(findGoogleDriveFileInFolder(context, { rootFolderId: "root", filePath: "2024/Plan.url" }))
      .resolves.toEqual({ fileId: "doc-1", name: "Plan", mimeType: "application/vnd.google-apps.document" });
  });

  it("keeps a real `.url` file distinct from a native file with the same stem", async () => {
    installFakeDrive(files);
    await expect(findGoogleDriveFileInFolder(context, { rootFolderId: "root", filePath: "Plan.url" }))
      .resolves.toMatchObject({ fileId: "url-1" });
  });

  it("reads fullwidth slashes as slashes and follows shortcuts", async () => {
    installFakeDrive(files);
    await expect(findGoogleDriveFileInFolder(context, { rootFolderId: "root", filePath: "a／b.pdf" }))
      .resolves.toMatchObject({ fileId: "pdf-1" });
    await expect(findGoogleDriveFileInFolder(context, { rootFolderId: "root", filePath: "Shared" }))
      .resolves.toMatchObject({ fileId: "pdf-9", mimeType: "application/pdf" });
  });

  it("rejects paths that leave the folder or do not exist", async () => {
    installFakeDrive(files);
    await expect(findGoogleDriveFileInFolder(context, { rootFolderId: "root", filePath: "../secret.pdf" })).rejects.toThrow(/inside the linked folder/);
    await expect(findGoogleDriveFileInFolder(context, { rootFolderId: "root", filePath: "2024/missing.pdf" })).rejects.toThrow(/not found/);
  });
});
