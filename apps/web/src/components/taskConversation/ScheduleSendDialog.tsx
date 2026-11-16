import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

function localDateTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ScheduleSendDialog(props: { onClose: () => void; onSchedule: (sendAt: string) => void }) {
  const [value, setValue] = useState(() => localDateTime(new Date(Date.now() + 60 * 60_000)));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      setError("Choose a time in the future.");
      return;
    }
    props.onSchedule(date.toISOString());
    props.onClose();
  }

  return createPortal(
    <div className="legal-overlay" onClick={props.onClose}>
      <div className="legal-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-send-title"
        style={{ maxWidth: "22rem" }} onClick={(event) => event.stopPropagation()}>
        <div className="legal-modal-header">
          <h2 id="schedule-send-title">Schedule send</h2>
          <button type="button" className="legal-close" aria-label="Close" onClick={props.onClose}><X size={18} /></button>
        </div>
        <form className="legal-modal-body" onSubmit={submit}>
          <input type="datetime-local" className="schedule-send-input" aria-label="Send at" required autoFocus
            min={localDateTime(new Date())} value={value} onChange={(event) => setValue(event.target.value)} />
          {error ? <p role="alert">{error}</p> : null}
          <div className="computer-use-modal-footer" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn ghost" onClick={props.onClose}>Cancel</button>
            <button type="submit" className="btn primary">Schedule send</button>
          </div>
        </form>
      </div>
    </div>, document.body
  );
}
