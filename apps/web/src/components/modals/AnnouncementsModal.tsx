import { useEffect } from "react";
import { X, Megaphone } from "lucide-react";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  notify: boolean;
  created_at: string;
}

const DISMISSED_KEY = "meowbert_dismissed_announcements";

export function getDismissedAnnouncementIds(): Set<string> {
  try {
    const stored = localStorage.getItem(DISMISSED_KEY);
    return new Set(stored ? (JSON.parse(stored) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markAnnouncementsRead(ids: string[]): void {
  const existing = getDismissedAnnouncementIds();
  for (const id of ids) existing.add(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...existing]));
}

interface AnnouncementsModalProps {
  announcements: Announcement[];
  onClose: () => void;
}

export function AnnouncementsModal({ announcements, onClose }: AnnouncementsModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Mark all notify announcements read when the modal is opened
  useEffect(() => {
    const notifyIds = announcements.filter((a) => a.notify).map((a) => a.id);
    if (notifyIds.length > 0) markAnnouncementsRead(notifyIds);
  }, [announcements]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem"
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "520px",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
          border: "1px solid var(--border-color, #e2e8f0)"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 1.25rem",
          borderBottom: "1px solid var(--border-color, #e2e8f0)",
          flexShrink: 0
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Megaphone size={16} />
            <strong>Announcements</strong>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.1rem", display: "flex" }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {announcements.length === 0 ? (
            <p style={{ color: "var(--text-muted)", margin: 0 }}>No announcements yet.</p>
          ) : (
            announcements.map((a) => (
              <div key={a.id} style={{
                padding: "0.9rem 1rem",
                borderRadius: "8px",
                background: "var(--surface-muted, #f8fafc)",
                border: "1px solid var(--border-color, #e2e8f0)"
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", marginBottom: "0.35rem" }}>
                  <strong style={{ fontSize: "0.9rem" }}>{a.title}</strong>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "0.875rem", whiteSpace: "pre-wrap", color: "var(--text)" }}>{a.body}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
