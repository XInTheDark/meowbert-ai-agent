import { useEffect, useState } from "react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import {
  DEFAULT_DESKTOP_SHORTCUT_PREFERENCES,
  keyboardEventToAccelerator,
  type DesktopShortcutActionId,
  type DesktopShortcutPreferences
} from "../../desktop/desktopShortcuts";

export function useDesktopShortcutPreferences() {
  const { shortcutPreferences, saveShortcutPreferences } = useAppRuntime();
  const [recordingId, setRecordingId] = useState<DesktopShortcutActionId | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(next: DesktopShortcutPreferences, message: string) {
    setError(null);
    setStatus(null);
    try {
      await saveShortcutPreferences(next);
      setStatus(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function changeShortcut(actionId: DesktopShortcutActionId, accelerator: string | null) {
    await persist({ ...shortcutPreferences, [actionId]: accelerator }, "Shortcut updated.");
  }

  function cancelRecording() {
    setRecordingId(null);
    setStatus(null);
    setError(null);
  }

  useEffect(() => {
    if (!recordingId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        cancelRecording();
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        void changeShortcut(recordingId, null);
        setRecordingId(null);
        return;
      }
      const accelerator = keyboardEventToAccelerator(event);
      if (!accelerator) {
        setError("Use a key combination with a modifier like Cmd/Ctrl, Option, or Shift.");
        return;
      }
      void changeShortcut(recordingId, accelerator);
      setRecordingId(null);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recordingId, shortcutPreferences]);

  function recordShortcut(actionId: DesktopShortcutActionId) {
    setError(null);
    setStatus(null);
    setRecordingId(actionId);
  }

  async function resetShortcuts() {
    setRecordingId(null);
    await persist({ ...DEFAULT_DESKTOP_SHORTCUT_PREFERENCES }, "Shortcuts reset to defaults.");
  }

  return { shortcutPreferences, recordingId, status, error, changeShortcut, cancelRecording, recordShortcut, resetShortcuts };
}
