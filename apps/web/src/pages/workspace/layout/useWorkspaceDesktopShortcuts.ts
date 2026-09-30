import { useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";
import { acceleratorMatchesEvent } from "../../../desktop/desktopShortcuts";
import type { DesktopShortcutPreferences } from "../../../desktop/desktopShortcuts";
import { dispatchDesktopUploadRequest, isEditableTarget } from "./utils";

interface UseWorkspaceDesktopShortcutsInput {
  activeWorkspaceId: string;
  activeEnvironmentId: string | null;
  navigate: NavigateFunction;
  onOpenCommandPalette: () => void;
  onRevealCurrentFolder: () => Promise<void>;
  shortcutPreferences: DesktopShortcutPreferences;
}

export function useWorkspaceDesktopShortcuts(input: UseWorkspaceDesktopShortcutsInput): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const editableTarget = isEditableTarget(event.target);

      if (acceleratorMatchesEvent(event, input.shortcutPreferences.commandPalette)) {
        event.preventDefault();
        input.onOpenCommandPalette();
        return;
      }

      if (editableTarget) {
        return;
      }

      if (
        input.activeWorkspaceId
        && input.activeEnvironmentId
        && acceleratorMatchesEvent(event, input.shortcutPreferences.newTask)
      ) {
        event.preventDefault();
        input.navigate(`/app/${input.activeWorkspaceId}/projects/${input.activeEnvironmentId}/tasks/new`);
        return;
      }

      if (
        input.activeWorkspaceId
        && input.activeEnvironmentId
        && acceleratorMatchesEvent(event, input.shortcutPreferences.openFiles)
      ) {
        event.preventDefault();
        input.navigate(`/app/${input.activeWorkspaceId}/files`);
        return;
      }

      if (acceleratorMatchesEvent(event, input.shortcutPreferences.uploadFiles)) {
        event.preventDefault();
        dispatchDesktopUploadRequest();
        return;
      }

      if (acceleratorMatchesEvent(event, input.shortcutPreferences.revealFolder)) {
        event.preventDefault();
        void input.onRevealCurrentFolder();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    input.activeEnvironmentId,
    input.activeWorkspaceId,
    input.navigate,
    input.onOpenCommandPalette,
    input.onRevealCurrentFolder,
    input.shortcutPreferences
  ]);
}
