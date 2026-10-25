import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { app, dialog } from "electron";
import { z } from "zod";
import { RUN_API_PROTOCOL_VERSION } from "@meowbert/shared";
import { readBootstrapData, saveLocalExecutionSettings } from "../state";
import { createDeviceApi } from "../executor/device-api";
import { initializeDeviceWorkspace, verifyDeviceWorkspace } from "./roots";

async function deviceSession() {
  const bootstrap = await readBootstrapData(); const settings = bootstrap.localExecutionSettings;
  if (!bootstrap.token || !settings.serverBaseUrl) throw new Error("Sign in before creating a device workspace.");
  const api = createDeviceApi({ apiBaseUrl: settings.serverBaseUrl, token: bootstrap.token }, new AbortController().signal);
  const devices = await api.request<{ devices: Array<{ id: string }> }>("/api/devices");
  if (!devices.devices.some((device) => device.id === settings.deviceId)) {
    await api.request("/api/devices", "POST", { id: settings.deviceId, name: os.hostname(), platform: process.platform, architecture: process.arch,
      executorVersion: app.getVersion(), capabilities: { protocolVersion: RUN_API_PROTOCOL_VERSION, executorSupported: true } });
  }
  return { settings, api };
}

async function chooseFolder(title: string) {
  const result = await dialog.showOpenDialog({ title, properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function saveRoot(workspaceId: string, root: string, serverBaseUrl: string | null) {
  const latest = (await readBootstrapData()).localExecutionSettings;
  if (latest.serverBaseUrl !== serverBaseUrl) throw new Error("The active server changed. Relink the folder on the correct server.");
  await saveLocalExecutionSettings({ ...latest, enabled: true, workspaceRoots: { ...latest.workspaceRoots, [workspaceId]: root } });
}

export async function createDeviceWorkspace(name: string) {
  z.string().trim().min(1).max(80).parse(name);
  const root = await chooseFolder("Choose the workspace folder"); if (!root) return null;
  const markerExists = await fs.access(path.join(root, ".meowbert-workspace.json")).then(() => true, () => false);
  if (markerExists) throw new Error("This folder already belongs to a workspace. Use Relink instead.");
  const consent = await dialog.showMessageBox({ type: "info", title: "Create device workspace", message: "Files stay in the folder you choose.", detail: "What the agent reads is sent to the model through your server. Conversations and task settings are stored on the server. Deleting this workspace will not delete its folder.", buttons: ["Create", "Cancel"], defaultId: 0, cancelId: 1 });
  if (consent.response !== 0) return null;
  const { api, settings } = await deviceSession();
  const workspace = await api.request<{ id: string }>("/api/workspaces", "POST", { name, fileHost: { kind: "device", deviceId: settings.deviceId } });
  try {
    const canonical = await initializeDeviceWorkspace(root, workspace.id);
    await saveRoot(workspace.id, canonical, settings.serverBaseUrl);
  } catch (error) {
    await api.request("/api/workspaces/" + workspace.id, "DELETE").catch(() => undefined);
    throw error;
  }
  return workspace;
}

export async function relinkDeviceWorkspace(workspaceId: string) {
  z.string().uuid().parse(workspaceId);
  const root = await chooseFolder("Locate the existing workspace folder"); if (!root) return null;
  const canonical = await verifyDeviceWorkspace(root, workspaceId);
  const { api, settings } = await deviceSession();
  const result = await api.request<{ pending: boolean; readyAt?: string }>("/api/workspaces/" + workspaceId + "/relink", "POST", { deviceId: settings.deviceId });
  await saveRoot(workspaceId, canonical, settings.serverBaseUrl);
  return result;
}
