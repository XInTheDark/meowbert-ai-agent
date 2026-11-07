import { useMemo } from "react";
import type { ProjectMapDialogActions } from "./ProjectMapDialogs";
import type { ProjectMapController } from "./useProjectMap";

// The edits a member can make on the map. Each one saves, then reloads the map.
export function useProjectMapActions(controller: ProjectMapController) {
  const { run } = controller;
  return useMemo(() => {
    const dialogActions: ProjectMapDialogActions = {
      saveBrief: (markdown) => run((api) => api.setBrief(markdown)),
      saveNote: (folderId, markdown) => run((api) => api.setFolderNote(folderId, markdown)),
      createFolder: (name, parentFolderId) => run((api) => api.createFolder(name, parentFolderId)),
      renameFolder: (folderId, name) => run((api) => api.renameFolder(folderId, name)),
      createCard: (folderId, card) => run((api) => api.createCard({ folderId, ...card })),
      updateCard: (cardId, card) => run((api) => api.updateCard(cardId, card))
    };
    return {
      dialogActions,
      move: (ids: string[], folderId: string | null) => void run((api) => api.move(ids, folderId)),
      deleteCard: (cardId: string) => void run((api) => api.deleteCard(cardId)),
      deleteFolder: (folderId: string, name: string) => {
        if (window.confirm(`Delete the folder "${name}"? Everything in it moves up one level.`)) void run((api) => api.deleteFolder(folderId));
      }
    };
  }, [run]);
}
