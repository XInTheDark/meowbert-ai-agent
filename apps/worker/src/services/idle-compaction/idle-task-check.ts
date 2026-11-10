import { advanceCachebeat } from "../cachebeat/cachebeat.js";
import { compactIdleTaskIfDue } from "./idle-compaction.js";

// One check of an idle task: keep its prompt cache warm while cachebeat applies, then compact it
// while the cache is still warm. Returns the delay until the next check, or null when done.
export async function checkIdleTask(taskId: string): Promise<number | null> {
  const cachebeat = await advanceCachebeat(taskId);
  if (cachebeat.kind === "beating") return cachebeat.checkInMs;
  const outcome = await compactIdleTaskIfDue(taskId, cachebeat.kind === "finished" ? cachebeat.cacheReadAtMs : null);
  return outcome.kind === "due_later" ? outcome.delayMs : null;
}
