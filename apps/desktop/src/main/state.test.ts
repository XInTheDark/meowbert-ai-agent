import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.root }, safeStorage: { isEncryptionAvailable: () => false } }));
import { readBootstrapData, saveAuthToken, saveLocalExecutionSettings, saveServerProfilesState, saveActiveContext, grantLiveDriveConsent } from "./state";
state.root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-state-"));
afterAll(() => fs.rm(state.root, { recursive: true, force: true }));
it("isolates storage and download consent per server while retaining concurrent settings writes", async () => {
  const profiles = [{ id: "a",label:"A",baseUrl:"http://localhost:3001",mode:"local" as const },{ id:"b",label:"B",baseUrl:"http://localhost:3002",mode:"local" as const }];
  await saveServerProfilesState({ profiles,activeProfileId:"a" });
  const a = (await readBootstrapData()).localExecutionSettings;
  await Promise.all([saveAuthToken("token"),saveLocalExecutionSettings({ ...a,enabled:true,storageRoot:"/tmp/backend",downloadConsent:true,maxConcurrentRuns:3 }),saveActiveContext({workspaceId:"w",environmentId:"p"})]);
  const saved = await readBootstrapData();
  expect(saved.token).toBe("token"); expect(saved.activeContext.environmentId).toBe("p");
  await saveServerProfilesState({profiles,activeProfileId:"b"});
  const b = (await readBootstrapData()).localExecutionSettings;
  expect(b).toMatchObject({enabled:false,storageRoot:null,downloadConsent:false,maxConcurrentRuns:2});
  expect(b.deviceId).not.toBe(a.deviceId);
  await expect(saveLocalExecutionSettings(a)).rejects.toThrow(/server changed/);
  await saveServerProfilesState({profiles,activeProfileId:"a"});
  expect((await readBootstrapData()).localExecutionSettings).toMatchObject({enabled:true,storageRoot:"/tmp/backend",downloadConsent:true,deviceId:a.deviceId,maxConcurrentRuns:3});
});

it("retains native Drive consent through stale preferences and clears it when live folders are disabled", async () => {
  const previous = (await readBootstrapData()).localExecutionSettings;
  const settings = await saveLocalExecutionSettings({ ...previous, liveDriveEnabled: true });
  const connectionId = "a".repeat(64);
  expect(await grantLiveDriveConsent(settings.serverBaseUrl!, settings.deviceId, connectionId)).toBe(true);
  const saved = await saveLocalExecutionSettings({ ...settings, maxConcurrentRuns: 4, liveDriveConsents: {} });
  expect(saved).toMatchObject({ maxConcurrentRuns: 4, liveDriveConsents: { [connectionId]: true } });
  await saveLocalExecutionSettings({ ...saved, liveDriveEnabled: false });
  expect((await readBootstrapData()).localExecutionSettings.liveDriveConsents).toEqual({});
  expect(await grantLiveDriveConsent(settings.serverBaseUrl!, settings.deviceId, connectionId)).toBe(false);
});
