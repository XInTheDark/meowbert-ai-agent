import type { TaskStatus } from "./types.js";

// The Project Map is the project's task folders seen as a plan: each folder has a note, and can
// hold note cards for work nobody has started yet. The project brief sits above the tree.

export const PROJECT_MAP_CARD_STATES = ["idea", "next", "done"] as const;
export type ProjectMapCardState = (typeof PROJECT_MAP_CARD_STATES)[number];

export const PROJECT_BRIEF_MAX_CHARS = 40_000;
export const PROJECT_FOLDER_NOTE_MAX_CHARS = 20_000;
export const PROJECT_MAP_CARD_BODY_MAX_CHARS = 8_000;
export const PROJECT_MAP_NAME_MAX_CHARS = 120;
export const PROJECT_MAP_CARD_TITLE_MAX_CHARS = 240;
// Newest tasks first; a project with more top-level tasks shows only these on the map.
export const PROJECT_MAP_TASK_LIMIT = 1_000;

export interface ProjectMapFolder {
  id: string;
  parentFolderId: string | null;
  name: string;
  note: string;
  sortOrder: number;
}

export interface ProjectMapCard {
  id: string;
  folderId: string | null;
  title: string;
  body: string;
  state: ProjectMapCardState;
  sortOrder: number;
}

export interface ProjectMapTask {
  id: string;
  folderId: string | null;
  title: string | null;
  status: TaskStatus;
  updatedAt: string;
}

export interface ProjectMap {
  brief: string;
  folders: ProjectMapFolder[];
  cards: ProjectMapCard[];
  tasks: ProjectMapTask[];
  tasksTruncated: boolean;
}

export type ProjectMapStatusGroup = "active" | "needs_input" | "failed" | "done";

export function projectMapStatusGroup(status: TaskStatus): ProjectMapStatusGroup {
  if (status === "awaiting_input") return "needs_input";
  if (status === "failed") return "failed";
  if (status === "succeeded" || status === "cancelled") return "done";
  return "active";
}

export type ProjectMapRollup = Record<ProjectMapStatusGroup, number>;

function emptyRollup(): ProjectMapRollup {
  return { active: 0, needs_input: 0, failed: 0, done: 0 };
}

// Counts tasks in each folder and everything under it, keyed by folder id.
export function buildProjectMapRollups(map: Pick<ProjectMap, "folders" | "tasks">): Map<string, ProjectMapRollup> {
  const parentById = new Map(map.folders.map((folder) => [folder.id, folder.parentFolderId]));
  const rollups = new Map(map.folders.map((folder) => [folder.id, emptyRollup()]));
  for (const task of map.tasks) {
    const group = projectMapStatusGroup(task.status);
    const seen = new Set<string>();
    let cursor = task.folderId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const rollup = rollups.get(cursor);
      if (rollup) rollup[group] += 1;
      cursor = parentById.get(cursor) ?? null;
    }
  }
  return rollups;
}
