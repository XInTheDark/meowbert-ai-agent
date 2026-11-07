import type { ProjectMap, ProjectMapCardState } from "@meowbert/shared/project-map";
import type { ApiClient } from "../../../lib/api";

// Every Project Map request the web app makes. Folder create, rename and delete use the task folder routes.
export function createProjectMapApi(api: ApiClient, projectId: string) {
  const base = `/api/projects/${projectId}`;
  return {
    load: () => api.get<ProjectMap>(`${base}/map`),
    setBrief: (markdown: string) => api.put(`${base}/map/brief`, { markdown }),
    setFolderNote: (folderId: string, markdown: string) => api.put(`${base}/map/folders/${folderId}/note`, { markdown }),
    createCard: (input: { folderId: string | null; title: string; body: string; state: ProjectMapCardState }) =>
      api.post<{ id: string }>(`${base}/map/cards`, input),
    updateCard: (cardId: string, changes: { title?: string; body?: string; state?: ProjectMapCardState }) =>
      api.patch(`${base}/map/cards/${cardId}`, changes),
    deleteCard: (cardId: string) => api.delete(`${base}/map/cards/${cardId}`),
    move: (ids: string[], folderId: string | null) => api.post(`${base}/map/move`, { ids, folderId }),
    createFolder: (name: string, parentFolderId: string | null) =>
      api.post<{ folder: { id: string } }>(`${base}/task-folders`, { name, parentFolderId }),
    renameFolder: (folderId: string, name: string) => api.patch(`/api/task-folders/${folderId}`, { name }),
    deleteFolder: (folderId: string) => api.delete(`/api/task-folders/${folderId}`)
  };
}

export type ProjectMapApi = ReturnType<typeof createProjectMapApi>;
