import { normalizeTaskProgress, type TaskProgress } from "@meowbert/shared/task-progress";
import type { TaskMessage } from "../lib/types";

// What an activity card shows of the turn so far: the agent's latest update_progress and the
// files it marked as artifacts. Both build up over the turn, so later cards carry earlier ones.
export interface ActivityTurnState {
  progress: TaskProgress | null;
  artifactPaths: string[];
}

export const EMPTY_ACTIVITY_TURN_STATE: ActivityTurnState = { progress: null, artifactPaths: [] };

function readPaths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// An update may leave out the goal or the steps to keep what it said before.
function mergeProgress(previous: TaskProgress | null, next: TaskProgress): TaskProgress {
  return {
    goal: next.goal ?? previous?.goal ?? null,
    steps: next.steps.length > 0 ? next.steps : previous?.steps ?? []
  };
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
