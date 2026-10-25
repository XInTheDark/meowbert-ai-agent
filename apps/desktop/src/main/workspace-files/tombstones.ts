import fs from "node:fs/promises";
import path from "node:path";
import type { DeviceApi } from "../executor/device-api";
import { resolveDevicePath, verifyDeviceWorkspace } from "./roots";

interface Tombstone { id: string; workspace_id: string; kind: string; target_id: string; relative_path: string }
export async function applyDeviceTombstones(input: { api: DeviceApi; deviceId: string; scratchRoot: string; workspaceRoots: Record<string, string>; activeWorkspaceIds: Set<string> }) {
  const { items } = await input.api.request<{ items: Tombstone[] }>("/api/devices/" + input.deviceId + "/tombstones");
  for (const item of items) {
    try {
    if (input.activeWorkspaceIds.has(item.workspace_id)) continue;
    if (item.kind === "scratch" || item.kind === "workspace") {
      const relative = item.workspace_id + (item.kind === "scratch" && item.relative_path ? "/" + item.target_id : "");
      const root = await fs.realpath(input.scratchRoot).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      if (root) await fs.rm(await resolveDevicePath(root, relative), { recursive: true, force: true });
    } else {
      const root = input.workspaceRoots[item.workspace_id];
      // Keep the tombstone pending until the owner reconnects the missing folder.
      if (!root) continue;
      const canonical = await verifyDeviceWorkspace(root, item.workspace_id);
      if (!item.relative_path || !["task", "project"].includes(item.kind)) throw new Error("Invalid device cleanup target.");
      const target = await resolveDevicePath(canonical, item.relative_path);
      if (target === canonical || path.basename(target) === ".meowbert-workspace.json") throw new Error("Refusing to delete the workspace folder.");
      await fs.rm(target, { recursive: true, force: true });
    }
    await input.api.request("/api/devices/" + input.deviceId + "/tombstones/ack", "POST", { ids: [item.id] });
    } catch (error) { console.warn("Device cleanup will retry", item.id, error); }
  }
}
