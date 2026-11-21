import { useEffect, useState } from "react";
import {
  isBridgeTaskExecutionTarget,
  type LocalExecutionMode,
  type TaskExecutionTarget,
  type WorkspaceFileHost
} from "@meowbert/shared";
import type { ApiClient } from "../lib/api";

export interface LocalDeviceOption {
  id: string;
  name: string;
  hostMode?: boolean;
}

export interface ProjectExecutionTargetsState {
  enabled: boolean;
  devices: LocalDeviceOption[];
  fileHost: WorkspaceFileHost | null;
  defaultMode: LocalExecutionMode;
  currentDeviceId: string;
}

export interface BridgeComposerControl {
  active: boolean;
  disabled?: boolean;
  title: string;
  onToggle: () => void;
}

const EMPTY_TARGETS_STATE: ProjectExecutionTargetsState = {
  enabled: false,
  devices: [],
  fileHost: null,
  defaultMode: "sandbox",
  currentDeviceId: ""
};

export function useProjectExecutionTargets(
  api: ApiClient,
  projectId: string | null,
  enabled = true
): ProjectExecutionTargetsState {
  const isDesktop = typeof window !== "undefined" && Boolean(window.meowbertDesktop);
  const [devices, setDevices] = useState<LocalDeviceOption[]>([]);
  const [serverEnabled, setServerEnabled] = useState(false);
  const [fileHost, setFileHost] = useState<WorkspaceFileHost | null>(null);
  const [defaultMode, setDefaultMode] = useState<LocalExecutionMode>("sandbox");
  const [currentDeviceId, setCurrentDeviceId] = useState("");

  useEffect(() => {
    if (!isDesktop || !enabled) return;
    let cancelled = false;
    void window.meowbertDesktop?.getBootstrapData().then((data) => {
      if (cancelled) return;
      setDefaultMode(data.localExecutionSettings.defaultMode ?? "sandbox");
      setCurrentDeviceId(data.localExecutionSettings.deviceId ?? "");
    });
    return () => { cancelled = true; };
  }, [isDesktop, enabled]);

  useEffect(() => {
    if (!isDesktop || !enabled || !projectId) {
      setServerEnabled(false);
      setDevices([]);
      setFileHost(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void api.get<{ enabled: boolean; devices: LocalDeviceOption[]; fileHost?: WorkspaceFileHost }>(
        `/api/projects/${projectId}/execution-targets`
      ).then((result) => {
        if (cancelled) return;
        setServerEnabled(result.enabled);
        setDevices(result.devices);
        setFileHost(result.fileHost ?? null);
      }).catch(() => {
        if (cancelled) return;
        setServerEnabled(false);
        setDevices([]);
      });
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, projectId, isDesktop, enabled]);

  if (!isDesktop || !enabled) return EMPTY_TARGETS_STATE;
  return { enabled: serverEnabled, devices, fileHost, defaultMode, currentDeviceId };
}

function pickLocalDeviceForBridge(targets: ProjectExecutionTargetsState): LocalDeviceOption | null {
  if (targets.fileHost?.kind === "device") {
    const hostDeviceId = targets.fileHost.deviceId;
    return targets.devices.find((device) => device.id === hostDeviceId)
      ?? { id: hostDeviceId, name: "Local", hostMode: false };
  }
  return targets.devices.find((device) => device.id === targets.currentDeviceId)
    ?? targets.devices[0]
    ?? null;
}

export function resolveBridgeToggleTarget(input: {
  currentTarget: TaskExecutionTarget;
  previousNonBridgeTarget?: TaskExecutionTarget | null;
  targets: ProjectExecutionTargetsState;
  requireSandbox?: boolean;
}): TaskExecutionTarget | null {
  const { currentTarget, previousNonBridgeTarget, targets, requireSandbox } = input;
  if (currentTarget.kind === "local" && isBridgeTaskExecutionTarget(currentTarget)) {
    if (
      previousNonBridgeTarget
      && !(targets.fileHost?.kind === "device" && previousNonBridgeTarget.kind !== "local")
    ) {
      return previousNonBridgeTarget.kind === "local"
        ? { kind: "local", deviceId: previousNonBridgeTarget.deviceId, mode: previousNonBridgeTarget.mode }
        : { kind: "cloud" };
    }
    return {
      kind: "local",
      deviceId: currentTarget.deviceId,
      mode: currentTarget.mode
    };
  }

  if (currentTarget.kind === "local") {
    const mode: LocalExecutionMode = requireSandbox && currentTarget.mode === "host" ? "sandbox" : currentTarget.mode;
    return { kind: "local", deviceId: currentTarget.deviceId, mode, bridge: true };
  }

  const device = pickLocalDeviceForBridge(targets);
  if (!device) return null;
  const mode: LocalExecutionMode = requireSandbox
    ? "sandbox"
    : (targets.defaultMode === "host" && device.hostMode ? "host" : "sandbox");
  return { kind: "local", deviceId: device.id, mode, bridge: true };
}

export function formatBridgeControlTitle(input: {
  active: boolean;
  target: TaskExecutionTarget;
  disabledReason?: string | null;
}): string {
  if (input.disabledReason) return input.disabledReason;
  if (input.active && input.target.kind === "local") {
    const modeLabel = input.target.mode === "host" ? "Host" : "Sandbox";
    return `Bridge mode: On (Local · ${modeLabel}) — click to disable`;
  }
  return "Bridge mode: Off — drive this task from an external MCP harness";
}
