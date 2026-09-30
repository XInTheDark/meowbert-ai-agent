import { Check, X } from "lucide-react";
import type { WorkspaceInviteSummary } from "../../../lib/types";
import { formatDateTime } from "../../../lib/utils";
import { formatActor, formatInviteStorage } from "./workspaceManageFormat";
import type { WorkspaceManageState } from "./workspaceManageTypes";

interface InviteRowsProps {
  invites: WorkspaceInviteSummary[];
  state: Pick<WorkspaceManageState, "inviteDecisionId" | "inviteDetailsById" | "inviteDetailErrorsById" | "inviteDetailLoadingById">;
  onAccept: (invite: WorkspaceInviteSummary) => void;
  onReject: (invite: WorkspaceInviteSummary) => void;
}

export function InviteRows(props: InviteRowsProps) {
  if (props.invites.length === 0) {
    return <div className="workspace-manage-empty">No pending invites.</div>;
  }

  return (
    <div className="workspace-row-list">
      {props.invites.map((invite) => {
        const detail = props.state.inviteDetailsById[invite.id] ?? null;
        const error = props.state.inviteDetailErrorsById[invite.id] ?? null;
        const loading = props.state.inviteDetailLoadingById[invite.id] === true;
        const busy = props.state.inviteDecisionId === invite.id;

        return (
          <div key={invite.id} className="workspace-row invite">
            <div className="workspace-row-main">
              <div className="workspace-row-title">
                <strong>{invite.workspaceName}</strong>
                <span className="badge">Invite</span>
              </div>
              <div className="workspace-row-meta">
                <span>Owner {formatActor(invite.owner)}</span>
                <span>Invited by {formatActor(invite.invitedBy)}</span>
                <span>{formatDateTime(invite.invitedAt)}</span>
                <span>{detail ? `${detail.projectCount ?? detail.environmentCount} projects` : loading ? "Loading details" : "Details unavailable"}</span>
                <span>{detail ? formatInviteStorage(detail) : null}</span>
              </div>
              {error ? <p className="error-text">{error}</p> : null}
            </div>

            <div className="workspace-row-actions">
              <button className="btn ghost compact danger-outline" type="button" disabled={busy} onClick={() => props.onReject(invite)}>
                <X size={14} />
                {busy ? "Working" : "Reject"}
              </button>
              <button className="btn primary compact" type="button" disabled={busy} onClick={() => props.onAccept(invite)}>
                <Check size={14} />
                {busy ? "Working" : "Accept"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
