import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ScratchPriority } from "@meowbert/shared";
import type { ApiClient } from "../../../lib/api";

const PRIORITY_OPTIONS: Array<{ value: ScratchPriority; label: string; hint: string }> = [
  { value: "low", label: "Low", hint: "Cleared first. Finished tasks keep scratch for a day." },
  { value: "normal", label: "Normal", hint: "Finished tasks keep scratch for a few days, open tasks for two weeks." },
  { value: "high", label: "High", hint: "Kept until the disk runs low, then cleared last." }
];

// Platform-admin settings for one project. Only super admins open it.
export function ProjectAdminOptionsDialog(props: { api: ApiClient; projectId: string; projectName: string; onClose: () => void }) {
  const endpoint = `/api/admin/projects/${props.projectId}/scratch-priority`;
  const [priority, setPriority] = useState<ScratchPriority | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    props.api.get<{ scratchPriority: ScratchPriority }>(endpoint)
      .then((value) => { if (!cancelled) setPriority(value.scratchPriority); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [props.api, endpoint]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!priority) return;
    setSaving(true);
    setError(null);
    try {
      await props.api.patch(endpoint, { scratchPriority: priority });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return createPortal(
    <div className="legal-overlay" onClick={props.onClose}>
      <div className="legal-modal" role="dialog" aria-modal="true" aria-labelledby="project-admin-options-title"
        style={{ maxWidth: "26rem" }} onClick={(event) => event.stopPropagation()}>
        <div className="legal-modal-header">
          <h2 id="project-admin-options-title">Admin options</h2>
          <button type="button" className="legal-close" aria-label="Close" onClick={props.onClose}><X size={18} /></button>
        </div>
        <form className="legal-modal-body" onSubmit={submit}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <strong>Task scratch priority</strong>
            <select value={priority ?? ""} disabled={!priority || saving}
              onChange={(event) => setPriority(event.target.value as ScratchPriority)}>
              {priority ? null : <option value="">Loading...</option>}
              {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <p className="muted-text">{PRIORITY_OPTIONS.find((option) => option.value === priority)?.hint ?? `For ${props.projectName}.`}</p>
          {error ? <p role="alert" className="error-text">{error}</p> : null}
          <div className="computer-use-modal-footer" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn ghost" onClick={props.onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!priority || saving}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </div>
    </div>, document.body
  );
}
