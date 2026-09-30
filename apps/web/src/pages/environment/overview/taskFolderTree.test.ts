import { describe, expect, it } from "vitest";
import type { TaskFolderSummary, TaskSummary } from "../../../lib/types";
import { buildTaskTreeRows } from "./taskFolderTree";

function createFolder(partial: Partial<TaskFolderSummary> & { id: string; name: string }): TaskFolderSummary {
  return {
    id: partial.id,
    workspaceId: "ws-1",
    projectId: "proj-1",
    environmentId: "proj-1",
    parentFolderId: partial.parentFolderId ?? null,
    name: partial.name,
    sortOrder: partial.sortOrder ?? 0,
    directTaskCount: partial.directTaskCount ?? 0,
    childFolderCount: partial.childFolderCount ?? 0,
    createdAt: partial.createdAt ?? "2026-05-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-05-01T00:00:00.000Z"
  };
}

function createTask(partial: Partial<TaskSummary> & { id: string; title: string }): TaskSummary {
  return {
    id: partial.id,
    title: partial.title,
    status: partial.status ?? "succeeded",
    created_at: partial.created_at ?? "2026-05-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-05-01T00:00:00.000Z",
    folder_id: partial.folder_id ?? null,
    folder_sort_order: partial.folder_sort_order ?? 0,
    task_type: partial.task_type ?? "standard"
  };
}

function rowLabels(rows: ReturnType<typeof buildTaskTreeRows>): string[] {
  return rows.map((row) => row.kind === "folder" ? `folder:${row.folder.name}` : `task:${row.task.title}`);
}

describe("buildTaskTreeRows", () => {
  it("mixes root folders and tasks by the active sort", () => {
    const rows = buildTaskTreeRows({
      folders: [
        createFolder({ id: "folder-1", name: "Beta", updatedAt: "2026-05-03T00:00:00.000Z" })
      ],
      tasks: [
        createTask({ id: "task-1", title: "Alpha", updated_at: "2026-05-04T00:00:00.000Z" }),
        createTask({ id: "task-2", title: "Gamma", updated_at: "2026-05-02T00:00:00.000Z" })
      ],
      collapsedFolderIds: new Set(),
      filtered: false,
      folderFilter: "all",
      folderViewMode: "mixedTree",
      sortBy: "updated_at",
      sortDir: "desc"
    });

    expect(rowLabels(rows)).toEqual(["task:Alpha", "folder:Beta", "task:Gamma"]);
  });

  it("can preserve folders-first ordering", () => {
    const rows = buildTaskTreeRows({
      folders: [
        createFolder({ id: "folder-1", name: "Beta", updatedAt: "2026-05-03T00:00:00.000Z" })
      ],
      tasks: [
        createTask({ id: "task-1", title: "Alpha", updated_at: "2026-05-04T00:00:00.000Z" })
      ],
      collapsedFolderIds: new Set(),
      filtered: false,
      folderFilter: "all",
      folderViewMode: "foldersFirst",
      sortBy: "updated_at",
      sortDir: "desc"
    });

    expect(rowLabels(rows)).toEqual(["folder:Beta", "task:Alpha"]);
  });

  it("can render a flat task table without folder rows", () => {
    const rows = buildTaskTreeRows({
      folders: [
        createFolder({ id: "folder-1", name: "Container" })
      ],
      tasks: [
        createTask({ id: "task-1", title: "Nested", folder_id: "folder-1" }),
        createTask({ id: "task-2", title: "Root" })
      ],
      collapsedFolderIds: new Set(),
      filtered: false,
      folderFilter: "all",
      folderViewMode: "flatTasks",
      sortBy: "title",
      sortDir: "asc"
    });

    expect(rowLabels(rows)).toEqual(["task:Nested", "task:Root"]);
  });

  it("preserves search relevance order without folder regrouping", () => {
    const rows = buildTaskTreeRows({
      folders: [
        createFolder({ id: "folder-1", name: "Container" })
      ],
      tasks: [
        createTask({ id: "task-1", title: "Second newest", folder_id: "folder-1", updated_at: "2026-05-02T00:00:00.000Z" }),
        createTask({ id: "task-2", title: "Best match", updated_at: "2026-05-01T00:00:00.000Z" }),
        createTask({ id: "task-3", title: "Newest", updated_at: "2026-05-03T00:00:00.000Z" })
      ],
      collapsedFolderIds: new Set(),
      filtered: true,
      folderFilter: "all",
      folderViewMode: "mixedTree",
      sortBy: "relevance",
      sortDir: "desc"
    });

    expect(rowLabels(rows)).toEqual(["task:Second newest", "task:Best match", "task:Newest"]);
  });

  it("keeps collapsed folders closed in tree modes", () => {
    const rows = buildTaskTreeRows({
      folders: [
        createFolder({ id: "folder-1", name: "Closed", directTaskCount: 1 })
      ],
      tasks: [
        createTask({ id: "task-1", title: "Hidden", folder_id: "folder-1" })
      ],
      collapsedFolderIds: new Set(["folder-1"]),
      filtered: false,
      folderFilter: "all",
      folderViewMode: "mixedTree",
      sortBy: "title",
      sortDir: "asc"
    });

    expect(rowLabels(rows)).toEqual(["folder:Closed"]);
  });
});
