import { dialog } from "electron";
import type { LocalLiveFolder } from "@meowbert/shared";
import { readBootstrapData, grantLiveDriveConsent } from "../state";

let pending: Promise<unknown> = Promise.resolve();
const declined = new Set<string>();
export function confirmLiveFolderConsent(serverBaseUrl: string, deviceId: string, folder: LocalLiveFolder): Promise<boolean> {
  const work = pending.then(async () => {
    const { localExecutionSettings: current } = await readBootstrapData();
    if (current.serverBaseUrl !== serverBaseUrl || current.deviceId !== deviceId || !current.liveDriveEnabled) return false;
    if (current.liveDriveConsents?.[folder.connectionId]) return true;
    const key = serverBaseUrl + ":" + deviceId + ":" + folder.connectionId;
    if (declined.has(key)) return false;
    const result = await dialog.showMessageBox({ type: "warning", buttons: ["Allow", "Cancel"], defaultId: 1, cancelId: 1,
      title: "Allow live Google Drive folders", message: "This computer will store a credential with access to your entire Google Drive (" + folder.accountLabel + ").",
      detail: "It keeps working until you disconnect Google Drive in Meowbert or remove Meowbert's access in your Google account. Removing this device or ending the task doesn't revoke it." });
    if (result.response !== 0) { declined.add(key); return false; }
    return grantLiveDriveConsent(serverBaseUrl, deviceId, folder.connectionId);
  });
  pending = work.catch(() => undefined);
  return work;
}
