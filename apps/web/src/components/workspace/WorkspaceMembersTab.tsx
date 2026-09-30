import { FormEvent, useCallback, useEffect, useState } from "react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { LoadingIndicator } from "../LoadingIndicator";
import type { Workspace, WorkspaceMember, WorkspacePendingInvite } from "../../lib/types";
import { AdminTable, AdminTableCell, AdminTableRow } from "../admin/AdminTable";

interface WorkspaceMembersResponse {
  items: WorkspaceMember[];
}

interface WorkspaceInvitesResponse {
  items: WorkspacePendingInvite[];
}

interface InviteWorkspaceUserResponse {
  outcome: "invited" | "already-invited" | "already-member";
  invite: WorkspacePendingInvite | null;
}

function formatMemberStatus(member: WorkspaceMember): { label: string; background: string; color: string } {
  if (member.signupApprovalStatus === "pending") {
    return { label: "Pending Approval", background: "#fffbea", color: "#975a16" };
  }

  if (!member.isActive || member.signupApprovalStatus === "rejected") {
    return { label: "Inactive", background: "#fff5f5", color: "#c53030" };
  }

  return { label: "Active", background: "#e6fffa", color: "#2c7a7b" };
}

export function WorkspaceMembersTab(props: {
  workspace: Workspace;
}) {
  const { api, activeWorkspaceId, setFlash, user: currentUser } = useWorkspaceApp();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspacePendingInvite[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isRevokingInviteId, setIsRevokingInviteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOwner = props.workspace.role === "owner";

  const loadMembers = useCallback(async () => {
    if (!activeWorkspaceId || !isOwner) {
      setMembers([]);
      setInvites([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [membersResponse, invitesResponse] = await Promise.all([
        api.get<WorkspaceMembersResponse>(`/api/workspaces/${activeWorkspaceId}/members`),
        api.get<WorkspaceInvitesResponse>(`/api/workspaces/${activeWorkspaceId}/invites`)
      ]);
      setMembers(membersResponse.items);
      setInvites(invitesResponse.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspaceId, api, isOwner]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function handleAddMember(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!activeWorkspaceId || !emailDraft.trim()) {
      return;
    }

    setIsAdding(true);
    setError(null);
    try {
      const response = await api.post<InviteWorkspaceUserResponse>(`/api/workspaces/${activeWorkspaceId}/members`, {
        email: emailDraft.trim()
      });
      const invitedEmail = response.invite?.email ?? emailDraft.trim();
      setEmailDraft("");
      await loadMembers();
      setFlash({
        tone: "success",
        text: response.outcome === "invited"
          ? `${invitedEmail} has been invited to this workspace.`
          : response.outcome === "already-invited"
            ? `${invitedEmail} already has a pending invite.`
            : `${invitedEmail} already has access to this workspace.`
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemoveMember(member: WorkspaceMember): Promise<void> {
    if (!activeWorkspaceId) {
      return;
    }

    const confirmed = confirm(`Remove ${member.email} from ${props.workspace.name}? They will lose access to all workspace chats, files, and notifications.`);
    if (!confirmed) {
      return;
    }

    setError(null);
    try {
      await api.delete<{ ok: boolean }>(`/api/workspaces/${activeWorkspaceId}/members/${member.id}`);
      await loadMembers();
      setFlash({ tone: "success", text: `${member.email} was removed from the workspace.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRevokeInvite(invite: WorkspacePendingInvite): Promise<void> {
    if (!activeWorkspaceId) {
      return;
    }

    const confirmed = confirm(`Cancel the pending invite for ${invite.email}? This will remove the workspace from their Invites list until you send another invite.`);
    if (!confirmed) {
      return;
    }

    setIsRevokingInviteId(invite.id);
    setError(null);
    try {
      await api.delete<{ ok: boolean }>(`/api/workspaces/${activeWorkspaceId}/invites/${invite.id}`);
      await loadMembers();
      setFlash({ tone: "success", text: `Invite for ${invite.email} was revoked.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRevokingInviteId(null);
    }
  }

  if (!isOwner) {
    return (
      <div className="stack-form">
        <p className="muted-text">
          Workspace members can collaborate across chats, files, and notifications, but only owners can change membership.
        </p>
      </div>
    );
  }

  return (
    <div className="stack-form">
      <p className="muted-text">
        Invite teammates by email to let them review the workspace first. They will see it under Invites and can accept or reject before getting access.
      </p>

      <form className="row-actions" style={{ alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }} onSubmit={handleAddMember}>
        <label style={{ flex: "1 1 320px" }}>
          <strong>Invite member by email</strong>
          <input
            type="email"
            value={emailDraft}
            onChange={(event) => setEmailDraft(event.target.value)}
            placeholder="teammate@example.com"
            autoComplete="email"
            disabled={isAdding}
          />
        </label>
        <button className="btn primary" type="submit" disabled={isAdding || emailDraft.trim().length === 0}>
          {isAdding ? "Sending..." : "Send Invite"}
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="stack-form" style={{ gap: "0.75rem" }}>
        <div>
          <strong>Members</strong>
          <p className="muted-text" style={{ marginTop: "0.25rem" }}>
            Accepted members get access to all workspace chats, tasks, files, and notifications. Shell sessions and branch selection stay per-user.
          </p>
        </div>
        <AdminTable
          columns={[
            { key: "user", label: "User" },
            { key: "status", label: "Status" },
            { key: "role", label: "Role" },
            { key: "joined", label: "Joined" },
            { key: "actions", label: "Actions", align: "right" }
          ]}
        >
          {members.length === 0 ? (
            <AdminTableRow>
              <AdminTableCell colSpan={5}>
                {isLoading ? (
                  <LoadingIndicator size={20} label="Loading members..." delayMs={0} />
                ) : (
                  <span className="muted-text">No members yet.</span>
                )}
              </AdminTableCell>
            </AdminTableRow>
          ) : null}

          {members.map((member) => {
            const status = formatMemberStatus(member);
            const isCurrentUser = member.id === currentUser?.id;
            const canRemove = member.role === "member";

            return (
              <AdminTableRow key={member.id}>
                <AdminTableCell verticalAlign="top">
                  <div><strong>{member.displayName || "No Name"}</strong></div>
                  <div className="muted-text" style={{ fontSize: "0.9em" }}>{member.email}</div>
                  {isCurrentUser ? <div className="muted-text" style={{ fontSize: "0.8em" }}>You</div> : null}
                </AdminTableCell>
                <AdminTableCell>
                  <span style={{
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: status.background,
                    color: status.color,
                    fontSize: "0.85em"
                  }}>
                    {status.label}
                  </span>
                </AdminTableCell>
                <AdminTableCell>
                  <span className="muted-text" style={{ fontSize: "0.9em" }}>
                    {member.role === "owner" ? "Owner" : "Member"}
                  </span>
                </AdminTableCell>
                <AdminTableCell>
                  <span className="muted-text" style={{ fontSize: "0.9em" }}>
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </span>
                </AdminTableCell>
                <AdminTableCell align="right">
                  {canRemove ? (
                    <button className="btn ghost danger-outline" type="button" onClick={() => void handleRemoveMember(member)}>
                      Remove
                    </button>
                  ) : (
                    <span className="muted-text" style={{ fontSize: "0.85em" }}>
                      {isCurrentUser ? "Owner" : "Owner access"}
                    </span>
                  )}
                </AdminTableCell>
              </AdminTableRow>
            );
          })}
        </AdminTable>
      </div>

      <div className="stack-form" style={{ gap: "0.75rem" }}>
        <div>
          <strong>Pending Invites</strong>
          <p className="muted-text" style={{ marginTop: "0.25rem" }}>
            Pending invites stay out of the workspace until the recipient explicitly accepts.
          </p>
        </div>
        <AdminTable
          columns={[
            { key: "user", label: "User" },
            { key: "invitedBy", label: "Invited By" },
            { key: "invitedAt", label: "Sent" },
            { key: "actions", label: "Actions", align: "right" }
          ]}
        >
          {invites.length === 0 ? (
            <AdminTableRow>
              <AdminTableCell colSpan={4}>
                {isLoading ? (
                  <LoadingIndicator size={20} label="Loading invites..." delayMs={0} />
                ) : (
                  <span className="muted-text">No pending invites.</span>
                )}
              </AdminTableCell>
            </AdminTableRow>
          ) : null}

          {invites.map((invite) => (
            <AdminTableRow key={invite.id}>
              <AdminTableCell verticalAlign="top">
                <div><strong>{invite.displayName || "No Name"}</strong></div>
                <div className="muted-text" style={{ fontSize: "0.9em" }}>{invite.email}</div>
              </AdminTableCell>
              <AdminTableCell>
                <div className="muted-text" style={{ fontSize: "0.9em" }}>
                  {invite.invitedBy.displayName || invite.invitedBy.email}
                </div>
              </AdminTableCell>
              <AdminTableCell>
                <span className="muted-text" style={{ fontSize: "0.9em" }}>
                  {new Date(invite.invitedAt).toLocaleDateString()}
                </span>
              </AdminTableCell>
              <AdminTableCell align="right">
                <button
                  className="btn ghost danger-outline"
                  type="button"
                  disabled={isRevokingInviteId === invite.id}
                  onClick={() => void handleRevokeInvite(invite)}
                >
                  {isRevokingInviteId === invite.id ? "Revoking..." : "Revoke"}
                </button>
              </AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTable>
      </div>
    </div>
  );
}
