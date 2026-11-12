import { normalizeTaskProgress, type TaskProgress } from "@meowbert/shared/task-progress";
import type { TaskMessage } from "../lib/types";

// What an activity card shows: the agent's latest update_progress, which carries over between
// turns, and the files it marked as artifacts this turn. Later cards carry earlier ones.
export interface ActivityTurnState {
  progress: TaskProgress | null;
  artifactPaths: string[];
}

export const EMPTY_ACTIVITY_TURN_STATE: ActivityTurnState = { progress: null, artifactPaths: [] };

function readPaths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Each message stores the task's whole merged plan, so its steps replace the previous ones even
// when cleared. Older messages could leave out the goal to keep the previous one; a merged plan
// never drops it.
function mergeProgress(previous: TaskProgress | null, next: TaskProgress): TaskProgress {
  return { goal: next.goal ?? previous?.goal ?? null, status: next.status, steps: next.steps };
}

export function advanceActivityTurnState(state: ActivityTurnState, toolGroup: TaskMessage[]): ActivityTurnState {
  let progress = state.progress;
  let artifactPaths = state.artifactPaths;
  for (const message of toolGroup) {
    const update = normalizeTaskProgress(message.content_json?.progress);
    if (update) progress = mergeProgress(progress, update);
    const removed = new Set(readPaths(message.content_json?.removed_artifact_paths));
    const added = readPaths(message.content_json?.artifact_paths);
    if (removed.size > 0 || added.length > 0) {
      artifactPaths = [...artifactPaths.filter((path) => !removed.has(path) && !added.includes(path)), ...added];
    }
  }
  return progress === state.progress && artifactPaths === state.artifactPaths ? state : { progress, artifactPaths };
}
