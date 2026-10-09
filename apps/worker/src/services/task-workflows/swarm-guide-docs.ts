import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SwarmGuideRole = "leader" | "worker";

// prompt-texts ships in the worker image next to apps/, the same way as the personality prompts.
const GUIDE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../prompt-texts/agent-swarm");
const cache = new Map<SwarmGuideRole, string>();

export function loadSwarmGuideDoc(role: SwarmGuideRole): string {
  const cached = cache.get(role);
  if (cached !== undefined) return cached;
  const text = fs.readFileSync(path.join(GUIDE_DIRECTORY, `${role}.md`), "utf-8").trim();
  cache.set(role, text);
  return text;
}
