import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_SYNC_FILE_VERSION_MAX_BYTES } from "@meowbert/shared/live-sync-file-versions";
import { downloadGoogleDriveFileRevision, listGoogleDriveFileRevisions } from "./google-drive-revisions.js";

const context = { accessToken: "token", headers: {} };
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installRoutes(route: (url: URL, init?: RequestInit) => Response | undefined) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}${url.searchParams.has("alt") ? "?alt=media" : ""}`);
    return route(url, init) ?? json({ error: { message: "unexpected" } }, 500);
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listGoogleDriveFileRevisions", () => {
  const revisions = [
    { id: "r1", modifiedTime: "2026-01-01T00:00:00.000Z", size: "10" },
    { id: "r2", modifiedTime: "2026-02-01T00:00:00.000Z", size: "20", keepForever: true, lastModifyingUser: { displayName: "Ada" } },
    { id: "r3", modifiedTime: "2026-03-01T00:00:00.000Z", size: "30" }
  ];

  it("returns newest first, marks the head as current, and pages back by time", async () => {
    installRoutes((url) => url.pathname.endsWith("/revisions") ? json({ revisions }) : undefined);
    const file = { fileId: "file-1", name: "notes.pdf", mimeType: "application/pdf" };

    const latest = await listGoogleDriveFileRevisions(context, { file, limit: 2, modifiedBefore: null });
    expect(latest.versions.map((version) => [version.id, version.current])).toEqual([["r3", true], ["r2", false]]);
    expect(latest).toMatchObject({ totalVersions: 3, hasOlder: true, mayOmitOlderVersions: false });
    expect(latest.versions[1]).toMatchObject({ modifiedBy: "Ada", keepForever: true, sizeBytes: 20 });

    const older = await listGoogleDriveFileRevisions(context, { file, limit: 2, modifiedBefore: "2026-02-15T00:00:00.000Z" });
    expect(older.versions.map((version) => version.id)).toEqual(["r2", "r1"]);
    expect(older.hasOlder).toBe(false);
  });

  it("warns that Google may omit older versions of native files", async () => {
    installRoutes((url) => url.pathname.endsWith("/revisions") ? json({ revisions }) : undefined);
    const result = await listGoogleDriveFileRevisions(context, {
      file: { fileId: "doc-1", name: "Plan", mimeType: "application/vnd.google-apps.document" },
      limit: 50,
      modifiedBefore: null
    });
    expect(result.mayOmitOlderVersions).toBe(true);
  });
});

describe("downloadGoogleDriveFileRevision", () => {
  it("downloads a binary revision's own bytes", async () => {
    const calls = installRoutes((url) => {
      if (url.searchParams.get("alt") === "media") return new Response("old bytes");
      if (url.pathname.endsWith("/revisions/r1")) return json({ id: "r1", mimeType: "application/pdf", size: "9", modifiedTime: "2026-01-01T00:00:00.000Z" });
      return undefined;
    });
    const result = await downloadGoogleDriveFileRevision(context, {
      file: { fileId: "file-1", name: "notes.pdf", mimeType: "application/pdf" },
      versionId: "r1"
    });
    expect(Buffer.from(result.contentBase64, "base64").toString()).toBe("old bytes");
    expect(result).toMatchObject({ fileName: "notes.pdf", sizeBytes: 9, modifiedAt: "2026-01-01T00:00:00.000Z" });
    expect(calls).toContain("GET https://www.googleapis.com/drive/v3/files/file-1/revisions/r1?alt=media");
  });

  // Drive stand-in that only serves a binary version's bytes while it is pinned.
  function installPinningDrive(input: { pinnedAtStart: boolean; unpinFails?: boolean }) {
    let pinned = input.pinnedAtStart;
    const calls = installRoutes((url, init) => {
      if (url.pathname.endsWith("/revisions/r1") && init?.method === "PATCH") {
        const { keepForever } = JSON.parse(String(init.body)) as { keepForever: boolean };
        if (!keepForever && input.unpinFails) return json({ error: { message: "Backend error" } }, 400);
        pinned = keepForever;
        return json({ id: "r1" });
      }
      if (url.searchParams.get("alt") === "media") {
        return pinned ? new Response("old bytes") : json({ error: { message: "Only revisions marked keepForever can be downloaded." } }, 403);
      }
      if (url.pathname.endsWith("/revisions/r1")) return json({ id: "r1", size: "9", keepForever: input.pinnedAtStart });
      return undefined;
    });
    return { calls, isPinned: () => pinned };
  }

  const pdf = { fileId: "file-1", name: "notes.pdf", mimeType: "application/pdf" };

  it("pins a refused unpinned version just for the download, then removes the pin", async () => {
    const drive = installPinningDrive({ pinnedAtStart: false });
    const result = await downloadGoogleDriveFileRevision(context, { file: pdf, versionId: "r1" });
    expect(Buffer.from(result.contentBase64, "base64").toString()).toBe("old bytes");
    expect(result.warning).toBeNull();
    expect(drive.isPinned()).toBe(false);
    expect(drive.calls.filter((call) => call.startsWith("PATCH") || call.includes("alt=media"))).toEqual([
      "GET https://www.googleapis.com/drive/v3/files/file-1/revisions/r1?alt=media",
      "PATCH https://www.googleapis.com/drive/v3/files/file-1/revisions/r1",
      "GET https://www.googleapis.com/drive/v3/files/file-1/revisions/r1?alt=media",
      "PATCH https://www.googleapis.com/drive/v3/files/file-1/revisions/r1"
    ]);
  });

  it("never changes a version the user already pinned", async () => {
    const drive = installPinningDrive({ pinnedAtStart: true });
    await downloadGoogleDriveFileRevision(context, { file: pdf, versionId: "r1" });
    expect(drive.calls.some((call) => call.startsWith("PATCH"))).toBe(false);
    expect(drive.isPinned()).toBe(true);
  });

  it("still returns the copy, with a warning, when the pin can't be removed", async () => {
    installPinningDrive({ pinnedAtStart: false, unpinFails: true });
    const result = await downloadGoogleDriveFileRevision(context, { file: pdf, versionId: "r1" });
    expect(Buffer.from(result.contentBase64, "base64").toString()).toBe("old bytes");
    expect(result.warning).toMatch(/Keep forever/);
  });

  it("exports a Google Doc revision through its export link as an Office file", async () => {
    const calls = installRoutes((url) => {
      if (url.hostname === "docs.example.test") return new Response("docx bytes");
      if (url.pathname.endsWith("/revisions/r7")) return json({ id: "r7", exportLinks: { [DOCX]: "https://docs.example.test/export?revision=7" } });
      return undefined;
    });
    const result = await downloadGoogleDriveFileRevision(context, {
      file: { fileId: "doc-1", name: "Plan", mimeType: "application/vnd.google-apps.document" },
      versionId: "r7"
    });
    expect(result).toMatchObject({ fileName: "Plan.docx", mimeType: DOCX });
    expect(Buffer.from(result.contentBase64, "base64").toString()).toBe("docx bytes");
    expect(calls.some((call) => call.includes("alt=media"))).toBe(false);
  });

  it("falls back to a download operation when a Doc revision has no export link", async () => {
    installRoutes((url, init) => {
      if (url.hostname === "download.example.test") return new Response("exported");
      if (init?.method === "POST" && url.pathname.endsWith("/files/doc-1/download")) {
        expect(url.searchParams.get("revisionId")).toBe("r7");
        expect(url.searchParams.get("mimeType")).toBe(DOCX);
        return json({ name: "op-1", done: true, response: { downloadUri: "https://download.example.test/file" } });
      }
      if (url.pathname.endsWith("/revisions/r7")) return json({ id: "r7" });
      return undefined;
    });
    const result = await downloadGoogleDriveFileRevision(context, {
      file: { fileId: "doc-1", name: "Plan", mimeType: "application/vnd.google-apps.document" },
      versionId: "r7"
    });
    expect(Buffer.from(result.contentBase64, "base64").toString()).toBe("exported");
  });

  it("refuses versions above the size cap before downloading them", async () => {
    const calls = installRoutes((url) => url.pathname.endsWith("/revisions/r1")
      ? json({ id: "r1", size: String(LIVE_SYNC_FILE_VERSION_MAX_BYTES + 1) })
      : undefined);
    await expect(downloadGoogleDriveFileRevision(context, {
      file: { fileId: "file-1", name: "big.zip", mimeType: "application/zip" },
      versionId: "r1"
    })).rejects.toThrow(/larger than/);
    expect(calls.some((call) => call.includes("alt=media"))).toBe(false);
  });

  it("explains a purged version", async () => {
    installRoutes((url) => url.pathname.endsWith("/revisions/gone") ? json({ error: { message: "Revision not found" } }, 404) : undefined);
    await expect(downloadGoogleDriveFileRevision(context, {
      file: { fileId: "file-1", name: "notes.pdf", mimeType: "application/pdf" },
      versionId: "gone"
    })).rejects.toThrow(/purged/);
  });
});
