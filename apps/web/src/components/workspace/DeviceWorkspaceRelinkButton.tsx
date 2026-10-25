import { useState } from "react";
import { FolderOpen } from "lucide-react";

export function DeviceWorkspaceRelinkButton({ workspaceId }: { workspaceId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const relink = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.meowbertDesktop?.relinkDeviceWorkspace?.(workspaceId);
      if (result) setMessage(result.pending ? "Relinking after active runs stop. Tasks resume on this device when ready." : "Workspace folder connected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  return <span>
    {window.meowbertDesktop?.relinkDeviceWorkspace ? <button type="button" className="btn ghost compact" disabled={busy} onClick={() => void relink()}><FolderOpen size={14} />{busy ? "Relinking…" : "Relink"}</button> : <span className="muted-text">Files are on the workspace device.</span>}
    {message ? <span role="status" className="muted-text">{message}</span> : null}
  </span>;
}
