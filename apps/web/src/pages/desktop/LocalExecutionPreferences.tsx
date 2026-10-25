import { FolderOpen, RotateCcw } from "lucide-react";
import type { DesktopLocalExecutionSettings } from "../../desktop/platform";
import { DesktopPreferenceRow, DesktopPreferenceSection, DesktopPreferenceSwitch } from "./DesktopPreferenceFields";
import { LocalExecutionAccessPreferences } from "./LocalExecutionAccessPreferences";
import { useLocalExecutionPreferences } from "./useLocalExecutionPreferences";

export function LocalExecutionPreferences() {
  const preferences = useLocalExecutionPreferences();
  const { settings, status, busy, updateSettings } = preferences;
  if (!settings) return <p className="desktop-preferences-hint" role={preferences.error ? "alert" : "status"}>{preferences.error ?? "Loading local execution settings…"}</p>;
  const needsStorage = settings.enabled && !settings.storageRoot && !Object.keys(settings.workspaceRoots ?? {}).length;
  return (
    <form className="desktop-local-preferences" onSubmit={(event) => { event.preventDefault(); void preferences.save(); }}>
      <header className="desktop-preferences-panel-head">
        <div><h2>Local execution</h2><p>Run tasks in a sandbox or directly on this computer.</p></div>
      </header>
      <div className="desktop-execution-status" data-state={status?.state ?? "starting"}>
        <span className="desktop-preferences-status-dot" />
        <div role="status">
          <strong>{status?.state === "running" ? "Ready for local tasks" : status?.state === "error" ? "Connection needs attention" : status?.state === "disabled" ? "Local execution is off" : "Connecting…"}</strong>
          {status?.message ? <p>{status.message}</p> : null}
        </div>
        <button className="icon-btn" type="button" disabled={busy} onClick={() => void preferences.retry()} title="Retry connection" aria-label="Retry connection">
          <RotateCcw size={15} />
        </button>
      </div>
      <fieldset className="desktop-preferences-fieldset" disabled={busy}>
        <DesktopPreferenceSection title="Task execution">
          <DesktopPreferenceRow title="Enable on this server" description="Make this computer available for local tasks." controlId="local-enabled">
            <DesktopPreferenceSwitch id="local-enabled" checked={settings.enabled} onChange={(enabled) => updateSettings({ enabled })} />
          </DesktopPreferenceRow>
          <DesktopPreferenceRow title="Default mode" description="Choose where new local tasks run." controlId="local-default-mode">
            <select id="local-default-mode" value={settings.defaultMode ?? "sandbox"} onChange={(event) => updateSettings({ defaultMode: event.target.value as "sandbox" | "host" })}>
              <option value="sandbox">Sandbox</option><option value="host" disabled={!settings.hostConsent}>Host</option>
            </select>
          </DesktopPreferenceRow>
          <DesktopPreferenceRow title="Concurrent local tasks" description="Maximum tasks running at once, from 1 to 16." controlId="local-concurrency">
            <input className="desktop-preferences-number" id="local-concurrency" type="number" min={1} max={16} required value={settings.maxConcurrentRuns} onChange={(event) => updateSettings({ maxConcurrentRuns: Number(event.target.value) })} />
          </DesktopPreferenceRow>
          <DesktopPreferenceRow title="Sandbox downloads" description="Allow sandbox downloads and updates." controlId="local-downloads">
            <DesktopPreferenceSwitch id="local-downloads" checked={settings.downloadConsent} onChange={(downloadConsent) => updateSettings({ downloadConsent })} />
          </DesktopPreferenceRow>
        </DesktopPreferenceSection>
        <LocalExecutionStoragePreferences settings={settings} updateSettings={updateSettings} pickRoot={preferences.pickRoot} />
        <LocalExecutionAccessPreferences settings={settings} updateSettings={updateSettings} />
      </fieldset>
      <footer className="desktop-preferences-save-bar">
        <div aria-live="polite">
          {preferences.error ? <p className="error-text" role="alert">{preferences.error}</p> : preferences.saved ? <p className="desktop-preferences-feedback">Preferences saved.</p> : needsStorage ? <p className="desktop-preferences-hint">Choose a storage folder to enable local execution.</p> : null}
        </div>
        <button type="submit" className="btn primary" disabled={busy || needsStorage}>{busy ? "Saving…" : "Save changes"}</button>
      </footer>
    </form>
  );
}

function LocalExecutionStoragePreferences(props: {
  settings: DesktopLocalExecutionSettings;
  updateSettings: (patch: Partial<DesktopLocalExecutionSettings>) => void;
  pickRoot: () => Promise<void>;
}) {
  return (
    <DesktopPreferenceSection title="Storage">
      <DesktopPreferenceRow title="Storage backend ID" description="Match the backend configured on your server." controlId="local-backend-id">
        <input id="local-backend-id" value={props.settings.storageBackendId} onChange={(event) => props.updateSettings({ storageBackendId: event.target.value })} />
      </DesktopPreferenceRow>
      <DesktopPreferenceRow title="Storage folder" description={props.settings.storageRoot ? <code>{props.settings.storageRoot}</code> : "Choose the server backend folder containing .meowbert-storage.json."}>
        <button type="button" className="btn ghost" onClick={() => void props.pickRoot()}><FolderOpen size={15} /> Choose folder</button>
      </DesktopPreferenceRow>
    </DesktopPreferenceSection>
  );
}
