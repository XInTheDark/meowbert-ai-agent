import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, dialog: vi.fn(), save: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showMessageBox: state.dialog } }));
vi.mock("../state", () => ({ readBootstrapData: async () => ({ localExecutionSettings: state.settings }),
  grantLiveDriveConsent: async (server: string, device: string, connectionId: string) => {
    if (state.settings.serverBaseUrl !== server || state.settings.deviceId !== device || !state.settings.liveDriveEnabled) return false;
    state.settings = { ...state.settings, liveDriveConsents: { [connectionId]: true } };
    state.save(state.settings); return true;
  } }));
import { confirmLiveFolderConsent } from "./consent";
const folder = { linkId: "link", connectionId: "a".repeat(64), accountLabel: "user@example.test", localRelativePath: "context/docs" };
beforeEach(() => { vi.clearAllMocks(); state.settings = { serverBaseUrl: "https://server", deviceId: "device", liveDriveEnabled: true, hostConsent: true }; });
it("prompts once for simultaneous requests and preserves unrelated device settings", async () => {
  state.dialog.mockResolvedValue({ response: 0 });
  expect(await Promise.all([confirmLiveFolderConsent("https://server", "device", folder), confirmLiveFolderConsent("https://server", "device", folder)])).toEqual([true, true]);
  expect(state.dialog).toHaveBeenCalledOnce();
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ hostConsent: true, liveDriveConsents: { [folder.connectionId]: true } }));
});
it("does not save consent after the active server changes while the prompt is open", async () => {
  state.dialog.mockImplementationOnce(async () => { state.settings = { ...state.settings, serverBaseUrl: "https://other" }; return { response: 0 }; });
  expect(await confirmLiveFolderConsent("https://server", "device", { ...folder, connectionId: "b".repeat(64) })).toBe(false);
  expect(state.save).not.toHaveBeenCalled();
});
it("requires enabled settings on the same device before displaying a credential prompt", async () => {
  expect(await confirmLiveFolderConsent("https://server", "another-device", folder)).toBe(false);
  state.settings.liveDriveEnabled = false;
  expect(await confirmLiveFolderConsent("https://server", "device", folder)).toBe(false);
  expect(state.dialog).not.toHaveBeenCalled();
});
