import type { DesktopComputerStatus } from "@meowbert/shared";
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { DesktopPreferenceRow, DesktopPreferenceSection } from "./DesktopPreferenceFields";

export function DesktopComputerPreferences() {
  const { platform } = useAppRuntime();
  const [status, setStatus] = useState<DesktopComputerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void platform.getComputerStatus().then((value) => {
      if (!cancelled) setStatus(value);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, [platform]);

  async function runAction(action: () => Promise<DesktopComputerStatus | void>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const nextStatus = await action();
      if (nextStatus) setStatus(nextStatus);
      setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openScreenRecordingSettings() {
    const result = await platform.openScreenRecordingSettings();
    if (!result.ok) throw new Error(result.error ?? "Unable to open Screen Recording settings.");
  }

  const ready = status?.canControlComputer && status.canTakeScreenshot;
  return (
    <>
      <header className="desktop-preferences-panel-head">
        <div><h2>Computer use</h2><p>Manage the permissions Meowbert needs to control your desktop.</p></div>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => void runAction(() => platform.getComputerStatus(), "Permissions refreshed.")}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>
      <div className="desktop-execution-status" data-state={status ? (ready ? "running" : "error") : "starting"} role="status">
        <span className="desktop-preferences-status-dot" />
        <div>
          <strong>{status ? (ready ? "Ready for computer use" : "Permissions needed") : "Checking permissions…"}</strong>
          <p>{status?.available ? "This computer can run desktop actions." : status?.reason ?? "Checking this computer’s availability."}</p>
        </div>
      </div>
      <DesktopPreferenceSection title="System permissions">
        <DesktopPreferenceRow title="Accessibility" description="Allow Meowbert to click, type, and interact with apps.">
          <span className="desktop-permission-value">{status?.permissions.accessibility ?? "unknown"}</span>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void runAction(() => platform.requestAccessibilityPermission(), "Accessibility permission prompt opened.")}>
            Enable
          </button>
        </DesktopPreferenceRow>
        <DesktopPreferenceRow title="Screen Recording" description="Allow Meowbert to see what’s on your screen.">
          <span className="desktop-permission-value">{status?.permissions.screenRecording ?? "unknown"}</span>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void runAction(openScreenRecordingSettings, "Opened Screen Recording settings.")}>
            Open settings <ExternalLink size={13} />
          </button>
        </DesktopPreferenceRow>
      </DesktopPreferenceSection>
      {status?.display ? (
        <DesktopPreferenceSection title="Display">
          <DesktopPreferenceRow title="Primary display" description={status.display.width + " × " + status.display.height + " logical pixels"}>
            <span className="desktop-permission-value">{status.display.coordinateSpaceWidth} × {status.display.coordinateSpaceHeight} action space</span>
          </DesktopPreferenceRow>
        </DesktopPreferenceSection>
      ) : null}
      {message ? <p className="desktop-preferences-feedback" role="status">{message}</p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </>
  );
}
