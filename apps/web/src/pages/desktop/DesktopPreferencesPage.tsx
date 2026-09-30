import type { DesktopComputerStatus } from "@meowbert/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AppWindow,
  Command,
  Monitor,
  Globe,
  Keyboard,
  RefreshCcw,
  Trash2
} from "lucide-react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import {
  DEFAULT_DESKTOP_SHORTCUT_PREFERENCES,
  DESKTOP_SHORTCUT_DEFINITIONS,
  formatAcceleratorForDisplay,
  keyboardEventToAccelerator,
  type DesktopShortcutActionId,
  type DesktopShortcutPreferences
} from "../../desktop/desktopShortcuts";

type ShortcutScopeTab = "global" | "inApp";
type DesktopPreferencesSectionTab = "shortcuts" | "computerUse";

export function DesktopPreferencesPage() {
  const { capabilities, platform, shortcutPreferences, saveShortcutPreferences, activeContext } = useAppRuntime();
  const navigate = useNavigate();
  const [computerStatus, setComputerStatus] = useState<DesktopComputerStatus | null>(null);
  const [recordingId, setRecordingId] = useState<DesktopShortcutActionId | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ShortcutScopeTab>("global");
  const [activeSectionTab, setActiveSectionTab] = useState<DesktopPreferencesSectionTab>("shortcuts");

  const groupedDefinitions = useMemo(() => ({
    global: DESKTOP_SHORTCUT_DEFINITIONS.filter((definition) => definition.scope === "global"),
    inApp: DESKTOP_SHORTCUT_DEFINITIONS.filter((definition) => definition.scope === "inApp")
  }), []);

  useEffect(() => {
    if (!recordingId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecordingId(null);
        setStatus(null);
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        void handleShortcutChange(recordingId, null);
        setRecordingId(null);
        return;
      }

      const accelerator = keyboardEventToAccelerator(event);
      if (!accelerator) {
        setError("Use a key combination with a modifier like Cmd/Ctrl, Option, or Shift.");
        return;
      }

      void handleShortcutChange(recordingId, accelerator);
      setRecordingId(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recordingId, shortcutPreferences]);

  useEffect(() => {
    setRecordingId(null);
    setStatus(null);
    setError(null);
  }, [activeTab, activeSectionTab]);

  useEffect(() => {
    let cancelled = false;

    if (!capabilities.supportsComputerUse) {
      setComputerStatus(null);
      return;
    }

    void platform.getComputerStatus()
      .then((nextStatus) => {
        if (!cancelled) {
          setComputerStatus(nextStatus);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [capabilities.supportsComputerUse, platform]);

  async function persistPreferences(nextPreferences: DesktopShortcutPreferences, successMessage: string): Promise<void> {
    setError(null);

    try {
      await saveShortcutPreferences(nextPreferences);
      setStatus(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleShortcutChange(actionId: DesktopShortcutActionId, accelerator: string | null): Promise<void> {
    const nextPreferences: DesktopShortcutPreferences = {
      ...shortcutPreferences,
      [actionId]: accelerator
    };
    await persistPreferences(nextPreferences, "Shortcut updated.");
  }

  async function resetAllShortcuts(): Promise<void> {
    await persistPreferences({ ...DEFAULT_DESKTOP_SHORTCUT_PREFERENCES }, "Shortcuts reset to defaults.");
  }

  async function refreshComputerStatus(): Promise<void> {
    try {
      setError(null);
      setComputerStatus(await platform.getComputerStatus());
      setStatus("Computer use status refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function promptAccessibilityPermission(): Promise<void> {
    try {
      setError(null);
      setComputerStatus(await platform.requestAccessibilityPermission());
      setStatus("Accessibility permission prompt opened.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openScreenRecordingSettings(): Promise<void> {
    try {
      setError(null);
      const result = await platform.openScreenRecordingSettings();
      if (!result.ok) {
        throw new Error(result.error ?? "Unable to open Screen Recording settings.");
      }
      setStatus("Opened Screen Recording settings.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const activeDefinitions = activeTab === "global" ? groupedDefinitions.global : groupedDefinitions.inApp;
  const backTarget = activeContext.workspaceId
    ? (activeContext.environmentId
      ? `/app/${activeContext.workspaceId}/projects/${activeContext.environmentId}`
      : `/app/${activeContext.workspaceId}/projects`)
    : "/app";
  const activeDescription = activeTab === "global"
    ? "Works even when another app is frontmost."
    : "These only run while Meowbert Desktop is focused.";

  if (!capabilities.isDesktop) {
    return (
      <main className="desktop-preferences-shell">
        <section className="page-content desktop-preferences-page">
          <article className="section-card empty-card">
            <h3>Desktop preferences unavailable</h3>
            <p className="muted-text">Keyboard shortcut preferences are only available in Meowbert Desktop.</p>
            <Link className="btn primary" to="/">Back to Meowbert</Link>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="desktop-preferences-shell">
      <section className="page-content desktop-preferences-page">
        <article className="section-card">
          <div className="section-head">
            <div>
              <h3>Desktop Preferences</h3>
              <p className="muted-text">Customize shortcuts that are unique to Meowbert Desktop.</p>
            </div>
            <div className="desktop-preferences-actions">
              <button className="btn ghost" type="button" onClick={() => navigate(backTarget)}>
                Back
              </button>
              <button className="btn ghost" type="button" onClick={() => void platform.showQuickAgent()}>
                <Globe size={16} />
                Open Quick Agent
              </button>
            </div>
          </div>

          <div className="desktop-preferences-layout" style={{ marginTop: "1rem" }}>
            <aside className="desktop-preferences-sidebar">
              <button
                className={`desktop-preferences-nav-btn ${activeSectionTab === "shortcuts" ? "active" : ""}`}
                type="button"
                onClick={() => setActiveSectionTab("shortcuts")}
              >
                <span className="desktop-preferences-nav-label">
                  <Keyboard size={16} />
                  Shortcuts
                </span>
                <span className="desktop-preferences-nav-copy">Global and in-app hotkeys.</span>
              </button>
              {capabilities.supportsComputerUse ? (
                <button
                  className={`desktop-preferences-nav-btn ${activeSectionTab === "computerUse" ? "active" : ""}`}
                  type="button"
                  onClick={() => setActiveSectionTab("computerUse")}
                >
                  <span className="desktop-preferences-nav-label">
                    <Monitor size={16} />
                    Computer Use
                  </span>
                  <span className="desktop-preferences-nav-copy">Permissions and desktop readiness.</span>
                </button>
              ) : null}
            </aside>

            <div className="desktop-preferences-panel">
              {activeSectionTab === "shortcuts" ? (
                <>
                  <div className="section-head desktop-preferences-panel-head">
                    <div>
                      <h3>Shortcuts</h3>
                      <p className="muted-text">Customize shortcuts that are unique to Meowbert Desktop.</p>
                    </div>
                    <div className="desktop-preferences-actions">
                      <button className="btn ghost" type="button" onClick={() => void resetAllShortcuts()}>
                        <RefreshCcw size={16} />
                        Reset Defaults
                      </button>
                    </div>
                  </div>

                  <div className="tab-row" style={{ marginTop: "1rem" }}>
                    <button
                      className={`tab-btn ${activeTab === "global" ? "active" : ""}`}
                      type="button"
                      onClick={() => setActiveTab("global")}
                    >
                      Global
                    </button>
                    <button
                      className={`tab-btn ${activeTab === "inApp" ? "active" : ""}`}
                      type="button"
                      onClick={() => setActiveTab("inApp")}
                    >
                      In App
                    </button>
                  </div>

                  <div className="desktop-shortcut-tab-copy muted-text">
                    {activeTab === "global" ? <Globe size={16} /> : <AppWindow size={16} />}
                    <span>{activeDescription}</span>
                  </div>

                  <div className="desktop-shortcut-section" style={{ marginTop: "1rem" }}>
                    {activeDefinitions.map((definition) => (
                      <ShortcutRow
                        key={definition.id}
                        title={definition.title}
                        description={definition.description}
                        accelerator={shortcutPreferences[definition.id]}
                        isRecording={recordingId === definition.id}
                        onRecord={() => {
                          setError(null);
                          setStatus("Press your new shortcut.");
                          setRecordingId(definition.id);
                        }}
                        onClear={() => void handleShortcutChange(definition.id, null)}
                      />
                    ))}
                  </div>

                  <div className="desktop-shortcut-footer muted-text" style={{ marginTop: "1rem" }}>
                    <div>
                      <Command size={15} />
                      <span>Press <strong>Delete</strong> while recording to clear a shortcut.</span>
                    </div>
                    <div>
                      <Keyboard size={15} />
                      <span>Press <strong>Escape</strong> while recording to cancel.</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="section-head desktop-preferences-panel-head">
                    <div>
                      <h3>Computer Use</h3>
                      <p className="muted-text">Permission and readiness checks for desktop control.</p>
                    </div>
                    <div className="desktop-preferences-actions">
                      <button className="btn ghost" type="button" onClick={() => void refreshComputerStatus()}>
                        <RefreshCcw size={16} />
                        Refresh Status
                      </button>
                    </div>
                  </div>

                  <div className="desktop-shortcut-section" style={{ marginTop: "1rem" }}>
                    <div className="desktop-shortcut-row">
                      <div className="desktop-shortcut-copy">
                        <strong><Monitor size={16} style={{ marginRight: "0.35rem", verticalAlign: "text-bottom" }} /> Desktop executor</strong>
                        <p>{computerStatus?.available ? "This desktop can execute computer-use actions." : computerStatus?.reason ?? "Desktop computer use is unavailable."}</p>
                      </div>
                      <div className="desktop-shortcut-controls">
                        <span className={`badge ${computerStatus?.canControlComputer && computerStatus?.canTakeScreenshot ? "good" : "warning"}`}>
                          {computerStatus?.canControlComputer && computerStatus?.canTakeScreenshot ? "Ready" : "Needs setup"}
                        </span>
                      </div>
                    </div>

                    <div className="desktop-shortcut-row">
                      <div className="desktop-shortcut-copy">
                        <strong>Accessibility</strong>
                        <p>Status: {computerStatus?.permissions.accessibility ?? "unknown"}</p>
                      </div>
                      <div className="desktop-shortcut-controls">
                        <button className="btn ghost" type="button" onClick={() => void promptAccessibilityPermission()}>
                          Prompt
                        </button>
                      </div>
                    </div>

                    <div className="desktop-shortcut-row">
                      <div className="desktop-shortcut-copy">
                        <strong>Screen Recording</strong>
                        <p>Status: {computerStatus?.permissions.screenRecording ?? "unknown"}</p>
                      </div>
                      <div className="desktop-shortcut-controls">
                        <button className="btn ghost" type="button" onClick={() => void openScreenRecordingSettings()}>
                          Open Settings
                        </button>
                      </div>
                    </div>

                    {computerStatus?.display ? (
                      <div className="desktop-shortcut-row">
                        <div className="desktop-shortcut-copy">
                          <strong>Primary display</strong>
                          <p>
                            {computerStatus.display.width}x{computerStatus.display.height} logical pixels; action coordinate space {computerStatus.display.coordinateSpaceWidth}x{computerStatus.display.coordinateSpaceHeight}.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              )}

              {status ? <p className="desktop-shortcut-status desktop-shortcut-status-success">{status}</p> : null}
              {error ? <p className="error-text desktop-shortcut-status">{error}</p> : null}
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

function ShortcutRow(props: {
  title: string;
  description: string;
  accelerator: string | null;
  isRecording: boolean;
  onRecord: () => void;
  onClear: () => void;
}) {
  return (
    <div className="desktop-shortcut-row">
      <div className="desktop-shortcut-copy">
        <strong>{props.title}</strong>
        <p>{props.description}</p>
      </div>
      <div className="desktop-shortcut-controls">
        <button
          className={`btn ${props.isRecording ? "primary" : "ghost"}`}
          type="button"
          onClick={props.onRecord}
        >
          <Keyboard size={16} />
          <span>{props.isRecording ? "Press keys…" : formatAcceleratorForDisplay(props.accelerator)}</span>
        </button>
        <button className="btn ghost icon-btn" type="button" onClick={props.onClear} title="Clear shortcut" aria-label="Clear shortcut">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
