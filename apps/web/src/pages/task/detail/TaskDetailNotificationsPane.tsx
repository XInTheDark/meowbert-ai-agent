import type { LiveEvent } from "../../../lib/types";
import { badgeClass, formatRelative } from "../../../lib/utils";

interface TaskDetailNotificationsPaneProps {
  events: LiveEvent[];
}

export function TaskDetailNotificationsPane(props: TaskDetailNotificationsPaneProps) {
  return (
    <div className="page-content task-tab-pane">
      <div className="event-list">
        {props.events.map((evt) => {
          const channel = typeof evt.payload.channel === "string" ? evt.payload.channel : "unknown";
          const status = typeof evt.payload.status === "string" ? evt.payload.status : "unknown";
          const detail = typeof evt.payload.detail === "string" ? evt.payload.detail : null;
          const preview = typeof evt.payload.preview === "string" ? evt.payload.preview : null;
          const externalMessageId =
            typeof evt.payload.externalMessageId === "string" ? evt.payload.externalMessageId : null;

          return (
            <div key={evt.id} className="event-row">
              <header>
                <strong>{channel}</strong>
                <span>{formatRelative(evt.createdAt)}</span>
              </header>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <span className={badgeClass(status === "failed" ? "failed" : status === "sent" ? "succeeded" : "muted")}>
                  {status}
                </span>
                {externalMessageId ? (
                  <span className="muted-text" style={{ fontSize: "0.8rem" }}>
                    message id: {externalMessageId}
                  </span>
                ) : null}
              </div>
              {preview ? <pre style={{ fontSize: "0.8rem", maxHeight: "120px" }}>{preview}</pre> : null}
              {detail ? (
                <p className="muted-text" style={{ margin: 0, fontSize: "0.82rem" }}>
                  {detail}
                </p>
              ) : null}
            </div>
          );
        })}
        {props.events.length === 0 ? <p className="empty-hint">No notifications yet.</p> : null}
      </div>
    </div>
  );
}
