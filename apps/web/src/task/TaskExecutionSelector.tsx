import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import type { WorkspaceFileHost, TaskExecutionTarget } from "@meowbert/shared";
import type { ApiClient } from "../lib/api";

interface LocalDeviceOption { id: string; name: string; hostMode?: boolean }

export function TaskExecutionSelector(props: {
  api: ApiClient;
  projectId: string | null;
  target: TaskExecutionTarget;
  disabled: boolean;
  bridgeDisabled?: boolean;
  onChange: (target: TaskExecutionTarget) => void;
}) {
  const [devices, setDevices] = useState<LocalDeviceOption[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [fileHost, setFileHost] = useState<WorkspaceFileHost | null>(null);
  const [defaultMode, setDefaultMode] = useState<"sandbox" | "host">("sandbox");
  useEffect(() => {
    let cancelled = false;
    void window.meowbertDesktop?.getBootstrapData().then((data) => { if (!cancelled) setDefaultMode(data.localExecutionSettings.defaultMode ?? "sandbox"); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!props.projectId) return;
      void props.api.get<{ enabled: boolean; devices: LocalDeviceOption[]; fileHost?: WorkspaceFileHost }>(`/api/projects/${props.projectId}/execution-targets`).then((result) => {
        if (!cancelled) { setEnabled(result.enabled); setDevices(result.devices); setFileHost(result.fileHost ?? null); }
      }).catch(() => { if (!cancelled) { setEnabled(false); setDevices([]); } });
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [props.api, props.projectId]);
  useEffect(() => {
    if (fileHost?.kind === "device" && (props.target.kind !== "local" || props.target.deviceId !== fileHost.deviceId)) {
      props.onChange({ kind: "local", deviceId: fileHost.deviceId, mode: defaultMode });
    }
  }, [fileHost, props.target, props.onChange, defaultMode]);
  if (!enabled || !window.meowbertDesktop) return null;
  const selectedDeviceId = props.target.kind === "local" ? props.target.deviceId : null;
  return (
    <>
    {fileHost?.kind !== "device" ? <select aria-label="Execution location" className="btn ghost" value={props.target.kind === "local" ? props.target.deviceId : "cloud"} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value === "cloud" ? { kind: "cloud" } : { kind: "local", deviceId: event.target.value, mode: defaultMode })}>
      <option value="cloud">Cloud</option>
      {selectedDeviceId && !devices.some((device) => device.id === selectedDeviceId) ? <option value={selectedDeviceId}>Local (unavailable)</option> : null}
      {devices.map((device) => <option key={device.id} value={device.id}>Local · {device.name}</option>)}
    </select> : null}
    {props.target.kind === "local" ? <select aria-label="Local machine mode" className="btn ghost" value={props.target.mode} disabled={props.disabled} onChange={(event) => { if (props.target.kind === "local") props.onChange({ ...props.target, mode: event.target.value as "sandbox" | "host" }); }}>
      <option value="sandbox">Sandbox</option><option value="host" disabled={!devices.find((device) => device.id === selectedDeviceId)?.hostMode}>Host</option>
    </select> : null}
    {props.target.kind === "local" ? (
      <button
        type="button"
        className={`btn ${props.target.bridge ? "primary" : "ghost"}`}
        aria-pressed={props.target.bridge === true}
        aria-label={props.target.bridge ? "Disable Bridge mode" : "Enable Bridge mode"}
        title={props.bridgeDisabled ? "Bridge mode supports standard local tasks only" : "Drive this task from an external MCP harness"}
        disabled={props.disabled || props.bridgeDisabled}
        onClick={() => {
          if (props.target.kind !== "local") return;
          const next = { kind: "local" as const, deviceId: props.target.deviceId, mode: props.target.mode };
          props.onChange(props.target.bridge ? next : { ...next, bridge: true });
        }}
      >
        <Plug size={14} />
        Bridge
      </button>
    ) : null}
    </>
  );
}
