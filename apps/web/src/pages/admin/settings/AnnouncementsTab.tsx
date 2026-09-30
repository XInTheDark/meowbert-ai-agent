import type { FormEvent } from "react";
import { AdminTable, AdminTableCell, AdminTableRow } from "../../../components/admin/AdminTable";
import type { AnnouncementSummary } from "./shared";

interface AnnouncementsTabProps {
  announcements: AnnouncementSummary[];
  announcementTitle: string;
  announcementBody: string;
  announcementNotify: boolean;
  isAnnouncementSaving: boolean;
  error: string | null;
  onAnnouncementTitleChange: (value: string) => void;
  onAnnouncementBodyChange: (value: string) => void;
  onAnnouncementNotifyChange: (value: boolean) => void;
  onCreateAnnouncement: (event: FormEvent) => Promise<void>;
  onDeleteAnnouncement: (id: string) => Promise<void>;
}

export function AnnouncementsTab(props: AnnouncementsTabProps) {
  return (
    <div className="stack-form" style={{ marginTop: "1rem" }}>
      <form className="stack-form" onSubmit={(event) => void props.onCreateAnnouncement(event)}>
        <label>
          <strong>Title</strong>
          <input
            value={props.announcementTitle}
            onChange={(event) => props.onAnnouncementTitleChange(event.target.value)}
            placeholder="What's happening..."
          />
        </label>
        <label>
          <strong>Body</strong>
          <textarea
            value={props.announcementBody}
            onChange={(event) => props.onAnnouncementBodyChange(event.target.value)}
            rows={5}
            placeholder="Describe this announcement..."
          />
        </label>
        <label style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={props.announcementNotify}
            onChange={(event) => props.onAnnouncementNotifyChange(event.target.checked)}
          />
          <span>Notify users — show a banner to all users on the site</span>
        </label>
        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={props.isAnnouncementSaving}>
            {props.isAnnouncementSaving ? "Saving..." : "Post announcement"}
          </button>
        </div>
      </form>

      <div style={{ marginTop: "1.5rem" }}>
        <AdminTable
          columns={[
            { key: "title", label: "Title" },
            { key: "notify", label: "Notify" },
            { key: "created", label: "Created" },
            { key: "actions", label: "", align: "right" }
          ]}
        >
          {props.announcements.length === 0 ? (
            <AdminTableRow>
              <AdminTableCell colSpan={4}>
                <span className="muted-text">No announcements yet.</span>
              </AdminTableCell>
            </AdminTableRow>
          ) : (
            props.announcements.map((announcement) => (
              <AdminTableRow key={announcement.id}>
                <AdminTableCell>
                  <div><strong>{announcement.title}</strong></div>
                  <div className="muted-text" style={{ fontSize: "0.8rem" }}>
                    {announcement.body.slice(0, 120)}{announcement.body.length > 120 ? "..." : ""}
                  </div>
                </AdminTableCell>
                <AdminTableCell>{announcement.notify ? "Yes" : "No"}</AdminTableCell>
                <AdminTableCell>{new Date(announcement.created_at).toLocaleString()}</AdminTableCell>
                <AdminTableCell align="right">
                  <button className="btn ghost" style={{ fontSize: "0.8rem" }} onClick={() => void props.onDeleteAnnouncement(announcement.id)}>
                    Delete
                  </button>
                </AdminTableCell>
              </AdminTableRow>
            ))
          )}
        </AdminTable>
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}
    </div>
  );
}
