import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "", tasks: new Map<string, { workspace_id: string; scratch_present: boolean }>() }));
vi.mock("../../lib/config.js", () => ({ config: { runtime: { get taskScratch() { return { root: state.root }; } } } }));

function taskQuery(sql: string, params: unknown[]) {
  if (sql.includes("ANY($1::uuid[])")) {
    const ids = params[0] as string[];
    return { rows: ids.filter((id) => state.tasks.get(id)?.scratch_present).map((id) => ({ id, workspace_id: state.tasks.get(id)!.workspace_id })) };
  }
  const task = state.tasks.get(params[0] as string);
  return { rows: task ? [task] : [] };
}
vi.mock("../../lib/db.js", () => ({
  withTransaction: (fn: (client: unknown) => Promise<unknown>) => fn({ query: async (sql: string, params: unknown[]) => taskQuery(sql, params) })
}));

import { reclaimOrphanScratch } from "./scratch-orphans.js";

const client = { query: async (sql: string, params: unknown[]) => taskQuery(sql, params) } as never;
let sweepAt = 0;

describe("orphan scratch reclaim", () => {
  beforeEach(async () => {
    state.root = await fs.mkdtemp(path.join(os.tmpdir(), "scratch-orphans-"));
    state.tasks.clear();
    sweepAt += 10 * 3_600_000;
  });
  afterEach(async () => { await fs.rm(state.root, { recursive: true, force: true }); });

  async function scratch(workspaceId: string, taskId: string) {
    const dir = path.join(state.root, workspaceId, taskId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "venv"), "x");
    return dir;
  }

  it("removes scratch of deleted or detached tasks and keeps scratch that a task owns", async () => {
    const workspace = randomUUID();
    const [owned, deleted, detached] = [randomUUID(), randomUUID(), randomUUID()];
    state.tasks.set(owned, { workspace_id: workspace, scratch_present: true });
    state.tasks.set(detached, { workspace_id: workspace, scratch_present: false });
    const ownedDir = await scratch(workspace, owned);
    const deletedDir = await scratch(workspace, deleted);
    const detachedDir = await scratch(randomUUID(), detached);
    await fs.mkdir(path.join(state.root, ".history", workspace, owned), { recursive: true });

    expect(await reclaimOrphanScratch(client, sweepAt)).toBe(2);
    await expect(fs.access(ownedDir)).resolves.toBeUndefined();
    await expect(fs.access(deletedDir)).rejects.toThrow();
    await expect(fs.access(detachedDir)).rejects.toThrow();
    await expect(fs.access(path.join(state.root, ".history", workspace, owned))).resolves.toBeUndefined();
  });

  it("sweeps at most hourly", async () => {
    const workspace = randomUUID();
    expect(await reclaimOrphanScratch(client, sweepAt)).toBe(0);
    await scratch(workspace, randomUUID());
    expect(await reclaimOrphanScratch(client, sweepAt + 60_000)).toBe(0);
    expect(await reclaimOrphanScratch(client, sweepAt + 3_600_000)).toBe(1);
  });
});
