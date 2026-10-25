import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { readSandboxHistory, saveSandboxHistory, type SandboxHistory } from "./history";
it("keeps unknown historical update times unknown and persists actual image check metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-history-"));
  try {
    expect(await readSandboxHistory(root)).toEqual({image:null,digest:null,lastCheckedAt:null,lastUpdatedAt:null});
    const history: SandboxHistory = {image:"registry/image@sha256:first",digest:"sha256:first",lastCheckedAt:"2026-10-25T00:00:00Z",lastUpdatedAt:null};
    await saveSandboxHistory(root,history); expect(await readSandboxHistory(root)).toEqual(history);
    history.lastUpdatedAt = "2026-10-25T01:00:00Z";
    await saveSandboxHistory(root,history); expect(await readSandboxHistory(root)).toEqual(history);
    expect((await fs.stat(path.join(root,"sandbox-history.json"))).mode & 0o777).toBe(0o600);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
