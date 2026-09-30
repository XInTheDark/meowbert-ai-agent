import type { TaskFolderSummary, TaskSummary } from "../../../lib/types";
import type {
  TaskFolderFilter,
  TaskFolderViewMode,
  TaskScopeFilter,
  TaskSortBy,
  TaskSortDir,
  TaskStatusFilter,
  TaskTypeFilter
} from "./environmentOverviewTypes";

export type TaskTreeRow =
  | {
      kind: "folder";
      folder: TaskFolderSummary;
      depth: number;
      taskCount: number;
      childFolderCount: number;
    }
  | {
      kind: "task";
      task: TaskSummary;
      depth: number;
    };

interface FolderNode {
  folder: TaskFolderSummary;
  children: FolderNode[];
  tasks: TaskSummary[];
}

type MixedTreeEntry =
  | {
      kind: "folder";
      node: FolderNode;
    }
  | {
      kind: "task";
      task: TaskSummary;
    };

export function isTaskFolderFilterActive(folderFilter: TaskFolderFilter): boolean {
  return folderFilter !== "all";
}

export function isTaskListContentFiltered(input: {
  searchTerm: string;
  statusFilter: TaskStatusFilter;
  taskTypeFilter: TaskTypeFilter;
  scopeFilter: TaskScopeFilter;
  folderFilter: TaskFolderFilter;
}): boolean {
  return input.searchTerm.trim().length > 0
    || input.statusFilter.length > 0
    || input.taskTypeFilter.length > 0
    || input.scopeFilter !== "active"
    || isTaskFolderFilterActive(input.folderFilter);
}

function getTaskFolderId(task: TaskSummary): string | null {
  return task.folder_id ?? null;
}

function compareByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function compareFolders(a: TaskFolderSummary, b: TaskFolderSummary): number {
  return a.sortOrder - b.sortOrder
    || compareByName(a.name, b.name)
    || a.id.localeCompare(b.id);
}

function compareTaskDates(a: string, b: string, direction: TaskSortDir): number {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  const result = (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
  return direction === "asc" ? result : -result;
}

function compareTasks(a: TaskSummary, b: TaskSummary, sortBy: TaskSortBy, sortDir: TaskSortDir): number {
  if (sortBy === "relevance") {
    return 0;
  }

  if (sortBy === "title") {
    const result = compareByName(a.title || "Untitled Task", b.title || "Untitled Task");
    return sortDir === "asc" ? result : -result;
  }

  if (sortBy === "status") {
    const result = compareByName(a.status, b.status);
    return sortDir === "asc" ? result : -result;
  }

  const dateResult = compareTaskDates(
    sortBy === "created_at" ? a.created_at : a.updated_at,
    sortBy === "created_at" ? b.created_at : b.updated_at,
    sortDir
  );
  return dateResult || compareTaskDates(a.created_at, b.created_at, "desc") || a.id.localeCompare(b.id);
}

function compareEntityDates(a: string, b: string, direction: TaskSortDir): number {
  return compareTaskDates(a, b, direction);
}

function compareTaskToFolder(task: TaskSummary, folder: TaskFolderSummary, sortBy: TaskSortBy, sortDir: TaskSortDir): number {
  if (sortBy === "relevance") {
    return 1;
  }

  if (sortBy === "title") {
    const result = compareByName(task.title || "Untitled Task", folder.name);
    return sortDir === "asc" ? result : -result;
  }

  if (sortBy === "status") {
    const result = compareByName(task.status, "folder");
    return sortDir === "asc" ? result : -result;
  }

  const taskDate = sortBy === "created_at" ? task.created_at : task.updated_at;
  const folderDate = sortBy === "created_at" ? folder.createdAt : folder.updatedAt;
  return compareEntityDates(taskDate, folderDate, sortDir)
    || compareByName(task.title || "Untitled Task", folder.name)
    || task.id.localeCompare(folder.id);
}

function compareFolderToTask(folder: TaskFolderSummary, task: TaskSummary, sortBy: TaskSortBy, sortDir: TaskSortDir): number {
  return -compareTaskToFolder(task, folder, sortBy, sortDir);
}

function compareFoldersBySort(a: TaskFolderSummary, b: TaskFolderSummary, sortBy: TaskSortBy, sortDir: TaskSortDir): number {
  if (sortBy === "relevance") {
    return compareFolders(a, b);
  }

  if (sortBy === "title" || sortBy === "status") {
    const result = compareByName(a.name, b.name);
    return sortDir === "asc" ? result : -result;
  }

  const aDate = sortBy === "created_at" ? a.createdAt : a.updatedAt;
  const bDate = sortBy === "created_at" ? b.createdAt : b.updatedAt;
  return compareEntityDates(aDate, bDate, sortDir)
    || compareFolders(a, b);
}

function compareMixedTreeEntries(a: MixedTreeEntry, b: MixedTreeEntry, sortBy: TaskSortBy, sortDir: TaskSortDir): number {
  if (a.kind === "task" && b.kind === "task") {
    return compareTasks(a.task, b.task, sortBy, sortDir);
  }
  if (a.kind === "folder" && b.kind === "folder") {
    return compareFoldersBySort(a.node.folder, b.node.folder, sortBy, sortDir);
  }
  if (a.kind === "folder" && b.kind === "task") {
    return compareFolderToTask(a.node.folder, b.task, sortBy, sortDir);
  }
  if (a.kind === "task" && b.kind === "folder") {
    return compareTaskToFolder(a.task, b.node.folder, sortBy, sortDir);
  }
  return 0;
}

function buildMixedTreeEntries(nodes: FolderNode[], tasks: TaskSummary[]): MixedTreeEntry[] {
  return [
    ...nodes.map((node): MixedTreeEntry => ({ kind: "folder", node })),
    ...tasks.map((task): MixedTreeEntry => ({ kind: "task", task }))
  ];
}

function collectDescendantFolderIds(folderId: string, foldersByParent: Map<string | null, TaskFolderSummary[]>): Set<string> {
  const result = new Set<string>([folderId]);
  const visit = (parentId: string) => {
    for (const child of foldersByParent.get(parentId) ?? []) {
      if (result.has(child.id)) {
        continue;
      }
      result.add(child.id);
      visit(child.id);
    }
  };
  visit(folderId);
  return result;
}

function addAncestors(folderId: string | null, folderById: Map<string, TaskFolderSummary>, visibleFolderIds: Set<string>): void {
  let cursor = folderId ? folderById.get(folderId) ?? null : null;
  while (cursor) {
    if (visibleFolderIds.has(cursor.id)) {
      break;
    }
    visibleFolderIds.add(cursor.id);
    cursor = cursor.parentFolderId ? folderById.get(cursor.parentFolderId) ?? null : null;
  }
}

function buildNodes(
  parentId: string | null,
  visibleFolderIds: Set<string>,
  foldersByParent: Map<string | null, TaskFolderSummary[]>,
  tasksByFolder: Map<string | null, TaskSummary[]>
): FolderNode[] {
  return (foldersByParent.get(parentId) ?? [])
    .filter((folder) => visibleFolderIds.has(folder.id))
    .map((folder) => ({
      folder,
      children: buildNodes(folder.id, visibleFolderIds, foldersByParent, tasksByFolder),
      tasks: tasksByFolder.get(folder.id) ?? []
    }));
}

export function buildTaskTreeRows(input: {
  folders: TaskFolderSummary[];
  tasks: TaskSummary[];
  collapsedFolderIds: Set<string>;
  filtered: boolean;
  folderFilter: TaskFolderFilter;
  folderViewMode: TaskFolderViewMode;
  sortBy: TaskSortBy;
  sortDir: TaskSortDir;
}): TaskTreeRow[] {
  if (input.sortBy === "relevance") {
    return input.tasks.map((task) => ({ kind: "task", task, depth: 0 }));
  }

  const folderById = new Map(input.folders.map((folder) => [folder.id, folder]));
  const foldersByParent = new Map<string | null, TaskFolderSummary[]>();
  for (const folder of input.folders) {
    const key = folder.parentFolderId && folderById.has(folder.parentFolderId) ? folder.parentFolderId : null;
    const siblings = foldersByParent.get(key) ?? [];
    siblings.push(folder);
    foldersByParent.set(key, siblings);
  }
  for (const siblings of foldersByParent.values()) {
    siblings.sort(compareFolders);
  }

  const allowedFolderIds = input.folderFilter !== "all" && input.folderFilter !== "unfiled"
    ? collectDescendantFolderIds(input.folderFilter, foldersByParent)
    : null;
  const tasksByFolder = new Map<string | null, TaskSummary[]>();
  for (const task of input.tasks) {
    const folderId = getTaskFolderId(task);
    if (input.folderFilter === "unfiled" && folderId !== null) {
      continue;
    }
    if (allowedFolderIds && (!folderId || !allowedFolderIds.has(folderId))) {
      continue;
    }

    const key = folderId && folderById.has(folderId) ? folderId : null;
    const group = tasksByFolder.get(key) ?? [];
    group.push(task);
    tasksByFolder.set(key, group);
  }
  for (const group of tasksByFolder.values()) {
    group.sort((a, b) => compareTasks(a, b, input.sortBy, input.sortDir));
  }

  const visibleFolderIds = new Set<string>();
  if (input.folderFilter === "all" && !input.filtered) {
    for (const folder of input.folders) {
      visibleFolderIds.add(folder.id);
    }
  } else if (allowedFolderIds) {
    for (const folderId of allowedFolderIds) {
      visibleFolderIds.add(folderId);
    }
    addAncestors(input.folderFilter, folderById, visibleFolderIds);
  } else if (input.folderFilter !== "unfiled") {
    for (const task of input.tasks) {
      addAncestors(getTaskFolderId(task), folderById, visibleFolderIds);
    }
  }

  const rootTasks = tasksByFolder.get(null) ?? [];
  const rows: TaskTreeRow[] = [];
  if (input.folderViewMode === "flatTasks") {
    const flatRows: Array<Extract<TaskTreeRow, { kind: "task" }>> = [];
    for (const group of tasksByFolder.values()) {
      for (const task of group) {
        flatRows.push({ kind: "task", task, depth: 0 });
      }
    }
    flatRows.sort((left, right) => compareTasks(left.task, right.task, input.sortBy, input.sortDir));
    return flatRows;
  }

  const pushNode = (node: FolderNode, depth: number) => {
    rows.push({
      kind: "folder",
      folder: node.folder,
      depth,
      taskCount: node.folder.directTaskCount,
      childFolderCount: node.folder.childFolderCount
    });
    if (!input.filtered && input.collapsedFolderIds.has(node.folder.id)) {
      return;
    }

    if (input.folderViewMode === "foldersFirst") {
      for (const child of node.children) {
        pushNode(child, depth + 1);
      }
      for (const task of node.tasks) {
        rows.push({ kind: "task", task, depth: depth + 1 });
      }
      return;
    }

    const childEntries = buildMixedTreeEntries(node.children, node.tasks);
    childEntries.sort((left, right) => compareMixedTreeEntries(left, right, input.sortBy, input.sortDir));
    for (const entry of childEntries) {
      if (entry.kind === "folder") {
        pushNode(entry.node, depth + 1);
      } else {
        rows.push({ kind: "task", task: entry.task, depth: depth + 1 });
      }
    }
  };

  const rootNodes = buildNodes(null, visibleFolderIds, foldersByParent, tasksByFolder);
  if (input.folderViewMode === "foldersFirst") {
    for (const node of rootNodes) {
      pushNode(node, 0);
    }
    for (const task of rootTasks) {
      rows.push({ kind: "task", task, depth: 0 });
    }
    return rows;
  }

  const rootEntries = buildMixedTreeEntries(rootNodes, rootTasks);
  rootEntries.sort((left, right) => compareMixedTreeEntries(left, right, input.sortBy, input.sortDir));
  for (const entry of rootEntries) {
    if (entry.kind === "folder") {
      pushNode(entry.node, 0);
    } else {
      rows.push({ kind: "task", task: entry.task, depth: 0 });
    }
  }

  return rows;
}

export function buildTaskFolderOptions(folders: TaskFolderSummary[]): Array<{ value: TaskFolderFilter; label: string }> {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const foldersByParent = new Map<string | null, TaskFolderSummary[]>();
  for (const folder of folders) {
    const key = folder.parentFolderId && folderById.has(folder.parentFolderId) ? folder.parentFolderId : null;
    const siblings = foldersByParent.get(key) ?? [];
    siblings.push(folder);
    foldersByParent.set(key, siblings);
  }
  for (const siblings of foldersByParent.values()) {
    siblings.sort(compareFolders);
  }

  const options: Array<{ value: TaskFolderFilter; label: string }> = [
    { value: "all", label: "All tasks" },
    { value: "unfiled", label: "Unfiled" }
  ];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of foldersByParent.get(parentId) ?? []) {
      options.push({
        value: folder.id,
        label: `${"  ".repeat(depth)}${folder.name}`
      });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return options;
}
