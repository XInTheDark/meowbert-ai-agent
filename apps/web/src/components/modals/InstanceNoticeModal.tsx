import { useEffect } from "react";
import { X } from "lucide-react";

export function InstanceNoticeModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="legal-overlay" onClick={onClose}>
      <div className="legal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="legal-modal-header">
          <h2>Your data on this server</h2>
          <button className="legal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="legal-modal-body">
          <p>Meowbert is open-source software that anyone can run on their own server. This instance is operated independently, not by the Meowbert project.</p>
          <p>Your conversations, files, and task history are stored on this server. Whoever runs it can access that data, and chooses which AI providers receive your messages to generate responses.</p>
          <p>For questions about how your data is handled or to request deletion, contact the operator of this instance.</p>
        </div>
      </div>
    </div>
  );
}
