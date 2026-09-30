import { Check, Edit2, ExternalLink, Trash2, UserMinus, Users, X } from "lucide-react";
import type { WorkspaceIconKey } from "@meowbert/shared/workspace-icons";
import { WorkspaceIcon, WORKSPACE_ICON_OPTIONS } from "../../../components/workspaceIcon/WorkspaceIcon";
import { formatDateTime } from "../../../lib/utils";
import { formatActor } from "./workspaceManageFormat";
import type { WorkspaceListItem, WorkspaceManageState } from "./workspaceManageTypes";
import { WorkspaceMembersPanel } from "./WorkspaceMembersPanel";

interface WorkspaceRowsProps {
  activeWorkspaceId: string;
  workspaces: WorkspaceListItem[];
  state: Pick<
    WorkspaceManageState,
    | "editingId"
    | "editIconKey"
    | "editName"
    | "expandedWorkspaceIds"
    | "leavingWorkspaceId"
    | "workspaceMembersById"
    | "workspaceMembersErrorById"
    | "workspaceMembersLoadingById"
  >;
  onOpen: (workspaceId: string) => void;
  onEditNameChange: (value: string) => void;
  onEditIconChange: (value: WorkspaceIconKey) => void;
  onSetEditingWorkspace: (workspace: WorkspaceListItem | null) => void;
  onUpdate: (workspaceId: string) => void;
  onDelete: (workspaceId: string, name: string) => void;
  onLeave: (workspace: WorkspaceListItem) => void;
  onToggleMembers: (workspaceId: string) => void;
  onRefreshMembers: (workspaceId: string) => void;
}

export function WorkspaceRows(props: WorkspaceRowsProps) {
  if (props.workspaces.length === 0) {
    return <div className="workspace-manage-empty">No workspaces match your search.</div>;
  }

  return (
    <div className="workspace-row-list">
      {props.workspaces.map((workspace) => {
        const isCurrent = workspace.id === props.activeWorkspaceId;
        const isEditing = props.state.editingId === workspace.id;
        const isExpanded = props.state.expandedWorkspaceIds[workspace.id] === true;
        const memberCount = workspace.memberCount;

        return (
          <div key={workspace.id} className={`workspace-row${isCurrent ? " current" : ""}`}>
            <div className="workspace-row-main">
              <div className="workspace-row-title">
                {isEditing ? (
                  <div className="workspace-row-edit">
                    <input
                      autoFocus
                      value={props.state.editName}
                      onChange={(event) => props.onEditNameChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          props.onUpdate(workspace.id);
                        }
                        if (event.key === "Escape") {
                          props.onSetEditingWorkspace(null);
                        }
                      }}
                    />
                    <div className="workspace-icon-picker" role="radiogroup" aria-label="Workspace icon">
                      {WORKSPACE_ICON_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={props.state.editIconKey === option.key ? "selected" : ""}
                          onClick={() => props.onEditIconChange(option.key)}
                          role="radio"
                          aria-checked={props.state.editIconKey === option.key}
                          title={option.label}
                        >
                          <WorkspaceIcon iconKey={option.key} size={16} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="workspace-row-icon" aria-hidden="true">
                      <WorkspaceIcon iconKey={workspace.iconKey} size={16} />
                    </span>
                    <strong>{workspace.name}</strong>
                    {isCurrent ? <span className="badge good">Current</span> : null}
                    <span className="badge">{workspace.role}</span>
                  </>
                )}
              </div>

              <div className="workspace-row-meta">
                <span>Owner {formatActor(workspace.owner)}</span>
                <span>{workspace.projectCount} project{workspace.projectCount === 1 ? "" : "s"}</span>
                <span>{memberCount} member{memberCount === 1 ? "" : "s"}</span>
                <span>Updated {formatDateTime(workspace.updatedAt)}</span>
              </div>
            </div>

            <div className="workspace-row-actions">
              {isEditing ? (
                <>
                  <button className="btn ghost compact" type="button" onClick={() => props.onUpdate(workspace.id)}>
                    <Check size={14} /> Save
                  </button>
                  <button className="btn ghost compact" type="button" onClick={() => props.onSetEditingWorkspace(null)}>
                    <X size={14} /> Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="btn primary compact" type="button" onClick={() => props.onOpen(workspace.id)}>
                    <ExternalLink size={14} /> Open
                  </button>
                  <button className="btn ghost compact" type="button" onClick={() => props.onToggleMembers(workspace.id)}>
                    <Users size={14} /> {isExpanded ? "Hide" : "Members"}
                  </button>
                  {workspace.role === "owner" ? (
                    <>
                      <button className="btn ghost compact" type="button" onClick={() => props.onSetEditingWorkspace(workspace)}>
                        <Edit2 size={14} /> Edit
                      </button>
                      <button className="btn ghost compact danger-outline" type="button" onClick={() => props.onDelete(workspace.id, workspace.name)}>
                        <Trash2 size={14} /> Delete
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn ghost compact danger-outline"
                      type="button"
                      disabled={props.state.leavingWorkspaceId === workspace.id}
                      onClick={() => props.onLeave(workspace)}
                    >
                      <UserMinus size={14} />
                      {props.state.leavingWorkspaceId === workspace.id ? "Leaving" : "Leave"}
                    </button>
                  )}
                </>
              )}
            </div>

            {isExpanded ? (
              <WorkspaceMembersPanel
                members={props.state.workspaceMembersById[workspace.id] ?? []}
                error={props.state.workspaceMembersErrorById[workspace.id] ?? null}
                loading={props.state.workspaceMembersLoadingById[workspace.id] === true}
                onRefresh={() => props.onRefreshMembers(workspace.id)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
