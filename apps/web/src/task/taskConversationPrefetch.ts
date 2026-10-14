import type { ApiClient } from "../lib/api";
import type { TaskConversationPageResponse } from "../lib/types";
import { MESSAGE_CHUNK_SIZE } from "../pages/task/detail/taskDetailConstants";

// A page that opens straight into a known task can start loading its latest messages alongside the
// task itself, instead of after it. The conversation view takes the result once, if it is still fresh.
const PREFETCH_TTL_MS = 10_000;

const prefetched = new Map<string, { startedAt: number; promise: Promise<TaskConversationPageResponse> }>();

export function prefetchTaskConversation(api: ApiClient, taskId: string): void {
  const current = prefetched.get(taskId);
  if (current && Date.now() - current.startedAt <= PREFETCH_TTL_MS) return;
  const promise = api.get<TaskConversationPageResponse>(`/api/tasks/${taskId}/conversation?limit=${MESSAGE_CHUNK_SIZE}`);
  promise.catch(() => prefetched.delete(taskId));
  prefetched.set(taskId, { startedAt: Date.now(), promise });
}

// The prefetch asked for the viewer's current branch, so it only stands in for a request on that same
// branch; the caller checks the leaf on the result.
export function takePrefetchedTaskConversation(taskId: string): Promise<TaskConversationPageResponse> | null {
  const entry = prefetched.get(taskId);
  prefetched.delete(taskId);
  return entry && Date.now() - entry.startedAt <= PREFETCH_TTL_MS ? entry.promise : null;
}
