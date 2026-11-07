import { buildProjectMapRollups, type ProjectMap, type ProjectMapCard, type ProjectMapFolder, type ProjectMapRollup, type ProjectMapTask } from "@meowbert/shared/project-map";

export interface ProjectMapContents {
  folders: ProjectMapFolder[];
  cards: ProjectMapCard[];
  tasks: ProjectMapTask[];
}

// The map indexed for rendering: what sits directly in each folder (null is the top level).
export interface ProjectMapModel {
  map: ProjectMap;
  rollups: Map<string, ProjectMapRollup>;
  contents: (folderId: string | null) => ProjectMapContents;
  folder: (folderId: string) => ProjectMapFolder | undefined;
  path: (folderId: string | null) => ProjectMapFolder[];
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    const value = key(item);
    groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return groups;
}

export function buildProjectMapModel(map: ProjectMap): ProjectMapModel {
  const folders = groupBy(map.folders, (folder) => folder.parentFolderId);
  const cards = groupBy(map.cards, (card) => card.folderId);
  const tasks = groupBy(map.tasks, (task) => task.folderId);
  const byId = new Map(map.folders.map((folder) => [folder.id, folder]));
  return {
    map,
    rollups: buildProjectMapRollups(map),
    contents: (folderId) => ({ folders: folders.get(folderId) ?? [], cards: cards.get(folderId) ?? [], tasks: tasks.get(folderId) ?? [] }),
    folder: (folderId) => byId.get(folderId),
    path: (folderId) => {
      const trail: ProjectMapFolder[] = [];
      let cursor = folderId ? byId.get(folderId) : undefined;
      while (cursor && !trail.includes(cursor)) {
        trail.unshift(cursor);
        cursor = cursor.parentFolderId ? byId.get(cursor.parentFolderId) : undefined;
      }
      return trail;
    }
  };
}

export function firstLine(markdown: string): string {
  return markdown.split("\n").map((line) => line.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";
}
