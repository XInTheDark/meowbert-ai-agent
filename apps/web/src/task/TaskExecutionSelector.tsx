import { useEffect, useState } from "react";
import type { TaskExecutionTarget } from "@meowbert/shared";
import type { ApiClient } from "../lib/api";

interface LocalDeviceOption { id: string; name: string }

export function TaskExecutionSelector(props: {
  api: ApiClient;
  projectId: string | null;
  target: TaskExecutionTarget;
  disabled: boolean;
  onChange: (target: TaskExecutionTarget) => void;
}) {
  const [devices, setDevices] = useState<LocalDeviceOption[]>([]);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!props.projectId) return;
      void props.api.get<{ enabled: boolean; devices: LocalDeviceOption[] }>(`/api/projects/${props.projectId}/execution-targets`).then((result) => {
        if (!cancelled) { setEnabled(result.enabled); setDevices(result.devices); }
      }).catch(() => { if (!cancelled) { setEnabled(false); setDevices([]); } });
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [props.api, props.projectId]);
  if (!enabled) return null;
  const selectedDeviceId = props.target.kind === "local" ? props.target.deviceId : null;
  return (
    <select aria-label="Execution location" className="btn ghost" value={props.target.kind === "local" ? props.target.deviceId : "cloud"} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value === "cloud" ? { kind: "cloud" } : { kind: "local", deviceId: event.target.value, mode: "sandbox" })}>
      <option value="cloud">Cloud</option>
      {selectedDeviceId && !devices.some((device) => device.id === selectedDeviceId) ? <option value={selectedDeviceId}>Local (unavailable)</option> : null}
      {devices.map((device) => <option key={device.id} value={device.id}>Local · {device.name} · Sandbox</option>)}
    </select>
  );
}
