import { useEffect, useState } from "react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import type { DesktopLocalExecutionSettings, DesktopLocalExecutionStatus } from "../../desktop/platform";

export function LocalExecutionPreferences() {
  const { platform, activeServerProfile } = useAppRuntime();
  const [settings, setSettings] = useState<DesktopLocalExecutionSettings | null>(null);
  const [status, setStatus] = useState<DesktopLocalExecutionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void platform.getBootstrapData().then((data) => {
      if (!cancelled) setSettings(data.localExecutionSettings);
    }).catch((err) => { if (!cancelled) setError(String(err)); });
    const refresh = () => void platform.getLocalExecutionStatus().then((value) => {
      if (!cancelled) setStatus(value);
    }).catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 2_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [platform, activeServerProfile?.baseUrl]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      setSettings(await platform.saveLocalExecutionSettings(settings));
      setStatus(await platform.getLocalExecutionStatus());
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function pickRoot() {
    try {
      const root = await platform.pickLocalExecutionStorageRoot();
      if (root) setSettings((current) => current ? { ...current, storageRoot: root } : null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  if (!settings) return <p className="muted-text">{error ?? "Loading local execution settings…"}</p>;
  return (
    <div>
      <h3>Local Execution</h3>
      <p className="muted-text">Run tasks in Docker Desktop or directly on this computer. Server workspaces need a verified storage mount.</p>
      <div className="desktop-shortcut-section">
        <label className="desktop-shortcut-row">
          <span>Enable on this server</span>
          <input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
        </label>
        <label className="desktop-shortcut-row">
          <span>Concurrent local tasks</span>
          <input aria-label="Concurrent local tasks" type="number" min={1} max={16} value={settings.maxConcurrentRuns} disabled={busy} onChange={(event) => setSettings({ ...settings, maxConcurrentRuns: Number(event.target.value) })} />
        </label>
        <label className="desktop-shortcut-row">
          <span>Storage backend ID</span>
          <input aria-label="Storage backend ID" value={settings.storageBackendId} disabled={busy} onChange={(event) => setSettings({ ...settings, storageBackendId: event.target.value })} />
        </label>
        <div className="desktop-shortcut-row">
          <div className="desktop-shortcut-copy"><strong>Storage root</strong><p>{settings.storageRoot ?? "Choose the server backend folder containing .meowbert-storage.json."}</p></div>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void pickRoot()}>Choose Folder</button>
        </div>
      </div>
      <div className="desktop-shortcut-section">
        <label className="desktop-shortcut-row"><span>Default mode</span><select aria-label="Default local mode" value={settings.defaultMode ?? "sandbox"} onChange={(event) => setSettings({ ...settings, defaultMode: event.target.value as "sandbox" | "host" })}><option value="sandbox">Sandbox</option><option value="host" disabled={!settings.hostConsent}>Host</option></select></label>
        <label className="desktop-shortcut-row"><span>Allow host mode</span><input type="checkbox" checked={settings.hostConsent ?? false} onChange={(event) => setSettings({ ...settings, hostConsent: event.target.checked })} /></label>
        <label className="desktop-shortcut-row"><span>Host shell</span><input type="checkbox" checked={settings.hostShellEnabled ?? false} disabled={!settings.hostConsent} onChange={(event) => setSettings({ ...settings, hostShellEnabled: event.target.checked })} /></label>
        <label className="desktop-shortcut-row"><span>Computer Use</span><input type="checkbox" checked={settings.computerUseEnabled ?? false} onChange={(event) => setSettings({ ...settings, computerUseEnabled: event.target.checked })} /></label>
        <label className="desktop-shortcut-row"><span>Your Chrome</span><input type="checkbox" checked={settings.hostBrowserEnabled ?? false} onChange={(event) => setSettings({ ...settings, hostBrowserEnabled: event.target.checked })} /></label>
      </div>
      <label><input type="checkbox" checked={settings.downloadConsent} onChange={(event) => setSettings({ ...settings, downloadConsent: event.target.checked })} /> Allow sandbox downloads and updates</label>
      <div className="desktop-preferences-actions">
        <button type="button" className="btn primary" disabled={busy || (settings.enabled && !settings.storageRoot && !Object.keys(settings.workspaceRoots ?? {}).length)} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void platform.retryLocalExecution().then(setStatus).catch((err) => setError(String(err)))}>Retry</button>
      </div>
      {status ? <p role="status" className="muted-text">{status.message ?? (status.state === "running" ? "Ready for local tasks" : status.state)}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
