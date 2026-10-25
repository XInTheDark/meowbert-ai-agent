import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeDeviceWorkspace } from "./roots";
import { applyDeviceTombstones } from "./tombstones";

let root: string;
const workspaceId = "11111111-1111-4111-8111-111111111111";
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "device-cleanup-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function fixture(kind: string, relativePath: string) {
  const workspaceRoot = await initializeDeviceWorkspace(path.join(root, "workspace"), workspaceId);
  const request = vi.fn().mockResolvedValue({ items: [{ id: "deletion", workspace_id: workspaceId, target_id: "task", kind, relative_path: relativePath }] });
  return { api: { request } as never, request, deviceId: "device", scratchRoot: path.join(root, "scratch"), workspaceRoots: { [workspaceId]: workspaceRoot }, activeWorkspaceIds: new Set<string>() };
}
beforeEach(async () => { await fs.mkdir(path.join(root, "workspace")); });

it("retries cleanup after an active run stops and acknowledges only after deletion", async () => {
  const input = await fixture("task", "projects/project/.meowbert/task-runs/task");
  const target = path.join(input.workspaceRoots[workspaceId], "projects/project/.meowbert/task-runs/task");
  await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, "output"), "data");
  input.activeWorkspaceIds.add(workspaceId);
  await applyDeviceTombstones(input);
  expect(input.request).toHaveBeenCalledTimes(1);
  input.activeWorkspaceIds.clear();
  await applyDeviceTombstones(input);
  await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  expect(input.request).toHaveBeenLastCalledWith("/api/devices/device/tombstones/ack", "POST", { ids: ["deletion"] });
});

it("workspace deletion removes scratch but preserves the owner's folder and files", async () => {
  const input = await fixture("workspace", "");
  await fs.mkdir(path.join(input.scratchRoot, workspaceId), { recursive: true });
  await fs.writeFile(path.join(input.workspaceRoots[workspaceId], "keep.txt"), "owner data");
  await applyDeviceTombstones(input);
  expect(await fs.readFile(path.join(input.workspaceRoots[workspaceId], "keep.txt"), "utf8")).toBe("owner data");
  await expect(fs.stat(path.join(input.scratchRoot, workspaceId))).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps tombstones pending while a workspace folder is disconnected", async () => {
  const input = await fixture("project", "projects/project");
  await applyDeviceTombstones({ ...input, workspaceRoots: {} });
  expect(input.request).toHaveBeenCalledTimes(1);
});
