import { TASK_VIEWERS_KEY_PREFIX } from "@meowbert/shared";
import { redis } from "../../lib/redis.js";

// Whether anyone has the task open now, as recorded by the API's live task event streams.
export async function isTaskBeingViewed(taskId: string): Promise<boolean> {
  try {
    return await redis.zcount(`${TASK_VIEWERS_KEY_PREFIX}${taskId}`, Date.now(), "+inf") > 0;
  } catch {
    return false;
  }
}
