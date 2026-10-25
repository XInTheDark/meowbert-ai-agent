import type { DesktopLocalExecutionSettings } from "../../desktop/platform";
import { DesktopPreferenceRow, DesktopPreferenceSection, DesktopPreferenceSwitch } from "./DesktopPreferenceFields";

export function LocalExecutionAccessPreferences(props: {
  settings: DesktopLocalExecutionSettings;
  updateSettings: (patch: Partial<DesktopLocalExecutionSettings>) => void;
}) {
  const { settings, updateSettings } = props;
  return (
    <>
      <DesktopPreferenceSection title="Computer access">
        <DesktopPreferenceRow title="Allow host mode" controlId="local-host-mode" description="Let tasks run directly on this computer, outside the sandbox.">
          <DesktopPreferenceSwitch id="local-host-mode" checked={settings.hostConsent ?? false} onChange={(hostConsent) => updateSettings({ hostConsent })} />
        </DesktopPreferenceRow>
        <DesktopPreferenceRow title="Host shell" controlId="local-host-shell" description="Allow tasks to run shell commands on this computer.">
          <DesktopPreferenceSwitch id="local-host-shell" checked={settings.hostShellEnabled ?? false} disabled={!settings.hostConsent} onChange={(hostShellEnabled) => updateSettings({ hostShellEnabled })} />
        </DesktopPreferenceRow>
        <DesktopPreferenceRow title="Computer use" controlId="local-computer-use" description="Allow tasks to interact with your desktop.">
          <DesktopPreferenceSwitch id="local-computer-use" checked={settings.computerUseEnabled ?? false} onChange={(computerUseEnabled) => updateSettings({ computerUseEnabled })} />
        </DesktopPreferenceRow>
        <DesktopPreferenceRow title="Your Chrome" controlId="local-host-browser" description="Allow tasks to use your Chrome browser.">
          <DesktopPreferenceSwitch id="local-host-browser" checked={settings.hostBrowserEnabled ?? false} onChange={(hostBrowserEnabled) => updateSettings({ hostBrowserEnabled })} />
        </DesktopPreferenceRow>
      </DesktopPreferenceSection>
      <DesktopPreferenceSection title="Google Drive">
        <DesktopPreferenceRow title="Live Drive folders" controlId="local-live-drive" description="Access live Google Drive folders in macOS host mode.">
          <DesktopPreferenceSwitch id="local-live-drive" checked={settings.liveDriveEnabled ?? false} onChange={(liveDriveEnabled) => updateSettings({ liveDriveEnabled, ...(liveDriveEnabled ? {} : { liveDriveConsents: {} }) })} />
        </DesktopPreferenceRow>
        <p className="desktop-preferences-hint desktop-preferences-permission-note">
          Each connection asks to store a credential with access to your entire Drive. Disconnect Google Drive in Meowbert to revoke all copies; removing a device or ending a task does not revoke them.
        </p>
      </DesktopPreferenceSection>
    </>
  );
}
