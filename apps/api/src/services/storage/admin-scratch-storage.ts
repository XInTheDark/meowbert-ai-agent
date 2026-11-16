import fs from "node:fs/promises";
import { readScratchStorage } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";

export async function getAdminScratchStorage() {
  const result = await query<{ scratch_storage_limit_mb: string | null }>(
    "SELECT scratch_storage_limit_mb FROM platform_settings WHERE id = 1"
  );
  const value = result.rows[0]?.scratch_storage_limit_mb;
  const { root, eviction } = config.runtime.taskScratch;
  await fs.mkdir(root, { recursive: true });
  return { ...await readScratchStorage(root, value == null ? null : Number(value)), ...eviction };
}

export async function updateAdminScratchStorage(limitMb: number | null) {
  const { capacityBytes } = await getAdminScratchStorage();
  if (limitMb !== null && (!Number.isSafeInteger(limitMb) || limitMb <= 0 || limitMb * 1024 * 1024 > capacityBytes)) {
    throw Object.assign(new Error("Scratch storage limit must be positive and no larger than the backing filesystem capacity."), { statusCode: 400 });
  }
  await query("UPDATE platform_settings SET scratch_storage_limit_mb = $1 WHERE id = 1", [limitMb]);
  return getAdminScratchStorage();
}
