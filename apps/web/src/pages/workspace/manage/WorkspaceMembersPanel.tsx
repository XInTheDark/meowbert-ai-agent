import { RefreshCcw } from "lucide-react";
import type { WorkspaceMember } from "../../../lib/types";
import { formatDateTime } from "../../../lib/utils";
import { formatMemberState } from "./workspaceManageFormat";

interface WorkspaceMembersPanelProps {
  members: WorkspaceMember[];
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}

export function WorkspaceMembersPanel(props: WorkspaceMembersPanelProps) {
  return (
    <div className="workspace-members-panel">
      <div className="workspace-members-panel-head">
        <strong>Members</strong>
        <button className="btn ghost compact" type="button" onClick={props.onRefresh} disabled={props.loading}>
          <RefreshCcw size={14} />
          {props.loading ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}
      {props.loading && props.members.length === 0 ? <p className="muted-text">Loading members...</p> : null}
      {!props.loading && props.members.length === 0 && !props.error ? <p className="muted-text">No members found.</p> : null}

      {props.members.length > 0 ? (
        <div className="workspace-members-list">
          {props.members.map((member) => (
            <div key={member.id} className="workspace-member-row">
              <span>
                <strong>{member.displayName || member.email}</strong>
                <small>{member.email}</small>
              </span>
              <span className="workspace-member-meta">
                <span className="badge">{formatMemberState(member)}</span>
                <small>{formatDateTime(member.joinedAt)}</small>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
