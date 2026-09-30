import type {
  TaskHistoryConcreteTaskType,
  TaskHistorySearchInput,
  TaskHistorySearchPageRow,
  TaskSearchPreview
} from "@meowbert/shared/task-history-search";

export const TASK_SEARCH_INDEX_UID = "tasks";
export const TASK_SEARCH_HIGHLIGHT_PRE_TAG = "__MEOWBERT_HIGHLIGHT_START__";
export const TASK_SEARCH_HIGHLIGHT_POST_TAG = "__MEOWBERT_HIGHLIGHT_END__";
export const TASK_SEARCH_PREVIEW_LENGTH = 240;

export interface TaskSearchDocument {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  titleSort: string;
  contentText: string;
  status: string;
  scope: "active" | "trashed";
  taskType: TaskHistoryConcreteTaskType;
  folderId: string | null;
  folderPathIds: string[];
  isUnfiled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export type TaskSearchHit = Pick<TaskSearchDocument, "id"> & {
  _formatted?: Partial<Pick<TaskSearchDocument, "title" | "contentText">>;
};

export interface TaskSearchResultItem extends TaskHistorySearchPageRow {
  searchPreview: TaskSearchPreview | null;
}

export interface SearchProjectTasksInput {
  actorUserId: string;
  projectId: string;
  filters: TaskHistorySearchInput;
}

export interface SearchGlobalTasksInput {
  actorUserId: string;
  workspaceIds: string[] | null;
  filters: TaskHistorySearchInput;
}

export interface SearchTasksOutput {
  items: TaskSearchResultItem[];
  pagination: {
    page: number;
    pageSize: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    totalItems: number | null;
    totalPages: number | null;
  };
}
