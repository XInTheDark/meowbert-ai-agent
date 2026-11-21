import { useEffect } from "react";
import type { TaskExecutionTarget } from "@meowbert/shared";
import type { ApiClient } from "../lib/api";
import { useProjectExecutionTargets, type ProjectExecutionTargetsState } from "./useProjectExecutionTargets";

export function TaskExecutionSelector(props: {
  api: ApiClient;
  projectId: string | null;
  target: TaskExecutionTarget;
  disabled: boolean;
  targets?: ProjectExecutionTargetsState;
  onChange: (target: TaskExecutionTarget) => void;
}) {
  const fetchedTargets = useProjectExecutionTargets(props.api, props.projectId, !props.targets);
  const { enabled, devices, fileHost, defaultMode } = props.targets ?? fetchedTargets;

  useEffect(() => {
    if (fileHost?.kind === "device" && (props.target.kind !== "local" || props.target.deviceId !== fileHost.deviceId)) {
      props.onChange({ kind: "local", deviceId: fileHost.deviceId, mode: defaultMode });
    }
  }, [fileHost, props.target, props.onChange, defaultMode]);

  if (!enabled || !window.meowbertDesktop) return null;
  const selectedDeviceId = props.target.kind === "local" ? props.target.deviceId : null;
  return (
    <>
      {fileHost?.kind !== "device" ? (
        <select
          aria-label="Execution location"
          className="btn ghost"
          value={props.target.kind === "local" ? props.target.deviceId : "cloud"}
          disabled={props.disabled}
          onChange={(event) => props.onChange(
            event.target.value === "cloud"
              ? { kind: "cloud" }
              : {
                  kind: "local",
                  deviceId: event.target.value,
                  mode: defaultMode,
                  ...(props.target.kind === "local" && props.target.bridge ? { bridge: true } : {})
                }
          )}
        >
          <option value="cloud">Cloud</option>
          {selectedDeviceId && !devices.some((device) => device.id === selectedDeviceId) ? (
            <option value={selectedDeviceId}>Local (unavailable)</option>
          ) : null}
          {devices.map((device) => <option key={device.id} value={device.id}>Local · {device.name}</option>)}
        </select>
      ) : null}
      {props.target.kind === "local" ? (
        <select
          aria-label="Local machine mode"
          className="btn ghost"
          value={props.target.mode}
          disabled={props.disabled}
          onChange={(event) => {
            if (props.target.kind === "local") {
              props.onChange({ ...props.target, mode: event.target.value as "sandbox" | "host" });
            }
          }}
        >
          <option value="sandbox">Sandbox</option>
          <option value="host" disabled={!devices.find((device) => device.id === selectedDeviceId)?.hostMode}>Host</option>
        </select>
      ) : null}
    </>
  );
}
