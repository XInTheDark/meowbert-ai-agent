import fs from "node:fs/promises";
import path from "node:path";
export interface SandboxHistory {
  image: string | null;
  digest: string | null;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
}
export async function readSandboxHistory(resourcesRoot: string): Promise<SandboxHistory> {
  const empty = { image: null, digest: null, lastCheckedAt: null, lastUpdatedAt: null };
  try {
    const value = JSON.parse(await fs.readFile(path.join(resourcesRoot, "sandbox-history.json"), "utf8"));
    return Object.fromEntries(Object.keys(empty).map((key) => [key, typeof value[key] === "string" ? value[key] : null])) as unknown as SandboxHistory;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return empty; }
}
export async function saveSandboxHistory(resourcesRoot: string, history: SandboxHistory): Promise<void> {
  await fs.mkdir(resourcesRoot, { recursive: true });
  const file = path.join(resourcesRoot, "sandbox-history.json");
  await fs.writeFile(file + ".tmp", JSON.stringify(history), { mode: 0o600 });
  await fs.rename(file + ".tmp", file);
}
