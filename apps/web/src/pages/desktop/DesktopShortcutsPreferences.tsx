import { useState } from "react";
import { ArrowUpRight, RotateCcw, X } from "lucide-react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { DESKTOP_SHORTCUT_DEFINITIONS, formatAcceleratorForDisplay } from "../../desktop/desktopShortcuts";
import { DesktopPreferenceRow } from "./DesktopPreferenceFields";
import { useDesktopShortcutPreferences } from "./useDesktopShortcutPreferences";

export function DesktopShortcutsPreferences() {
  const { platform } = useAppRuntime();
  const shortcuts = useDesktopShortcutPreferences();
  const [scope, setScope] = useState<"global" | "inApp">("global");
  return (
    <>
      <header className="desktop-preferences-panel-head">
        <div>
          <h2>Shortcuts</h2>
          <p>Set the keys you use to get around Meowbert.</p>
        </div>
        <button className="btn ghost" type="button" onClick={() => void shortcuts.resetShortcuts()}>
          <RotateCcw size={14} /> Reset defaults
        </button>
      </header>
      <div className="desktop-shortcut-toolbar">
        <div className="desktop-shortcut-scopes" role="group" aria-label="Shortcut scope">
          {([{ id: "global", label: "Global" }, { id: "inApp", label: "In app" }] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={scope === tab.id}
              onClick={() => { shortcuts.cancelRecording(); setScope(tab.id); }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {scope === "global" ? (
          <button className="btn desktop-preferences-text-btn" type="button" onClick={() => void platform.showQuickAgent()}>
            Open Quick Agent <ArrowUpRight size={14} />
          </button>
        ) : null}
      </div>
      <p className="desktop-preferences-hint">
        {scope === "global" ? "Available even when you’re using another app." : "Available while Meowbert Desktop is focused."}
      </p>
      <div className="desktop-preference-rows">
        {DESKTOP_SHORTCUT_DEFINITIONS.filter((definition) => definition.scope === scope).map((definition) => (
          <DesktopPreferenceRow key={definition.id} title={definition.title} description={definition.description}>
            <button
              className={"desktop-shortcut-recorder " + (shortcuts.recordingId === definition.id ? "recording" : "")}
              type="button"
              aria-label={"Change " + definition.title + " shortcut"}
              aria-pressed={shortcuts.recordingId === definition.id}
              onClick={() => shortcuts.recordShortcut(definition.id)}
            >
              {shortcuts.recordingId === definition.id ? "Press keys…" : <kbd>{formatAcceleratorForDisplay(shortcuts.shortcutPreferences[definition.id])}</kbd>}
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-label={"Clear " + definition.title + " shortcut"}
              title="Clear shortcut"
              disabled={!shortcuts.shortcutPreferences[definition.id]}
              onClick={() => void shortcuts.changeShortcut(definition.id, null)}
            >
              <X size={15} />
            </button>
          </DesktopPreferenceRow>
        ))}
      </div>
      <p className="desktop-preferences-hint desktop-shortcut-help">
        Click a shortcut to record. <kbd>Esc</kbd> cancels; <kbd>Delete</kbd> clears. Changes save automatically.
      </p>
      {shortcuts.status ? <p className="desktop-preferences-feedback" role="status">{shortcuts.status}</p> : null}
      {shortcuts.error ? <p className="error-text" role="alert">{shortcuts.error}</p> : null}
    </>
  );
}
