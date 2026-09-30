import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { createApiClient } from "../../lib/api";
import { useOptionalWorkspaceApp } from "../../contexts/WorkspaceContext";
import { filterInviteRows, filterWorkspaceRows, sortWorkspaceRows } from "./manage/workspaceManageFilters";
import type { WorkspaceManageTab } from "./manage/workspaceManageTypes";
import { useWorkspaceManageController } from "./manage/useWorkspaceManageController";
import { WorkspaceRows } from "./manage/WorkspaceRows";
import { InviteRows } from "./manage/InviteRows";
import { InlineProgressBar } from "../../components/InlineProgressBar";

interface WorkspaceManagePageProps {
  token: string;
  setFlash: (flash: { tone: "success" | "error"; text: string } | null) => void;
}

export function WorkspaceManagePage({ token, setFlash }: WorkspaceManagePageProps) {
  const workspaceApp = useOptionalWorkspaceApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const fallbackApi = useMemo(() => createApiClient(token), [token]);
  const api = workspaceApp?.api ?? fallbackApi;
  const activeWorkspaceId = workspaceApp?.activeWorkspaceId ?? "";
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<WorkspaceManageTab>(() => searchParams.get("tab") === "invites" ? "invites" : "workspaces");
  const [newName, setNewName] = useState("");
  const controller = useWorkspaceManageController({
    api,
    activeWorkspaceId,
    setFlash,
    onWorkspaceListChanged: workspaceApp?.refreshWorkspaces
  });

  const visibleWorkspaces = useMemo(
    () => filterWorkspaceRows(sortWorkspaceRows(controller.workspaces, activeWorkspaceId), query),
    [activeWorkspaceId, controller.workspaces, query]
  );
  const visibleInvites = useMemo(
    () => filterInviteRows(controller.invites, query),
    [controller.invites, query]
  );

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setTimeout(() => document.getElementById("workspace-create-input")?.focus(), 0);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  function selectTab(nextTab: WorkspaceManageTab): void {
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    if (nextTab === "invites") {
      next.set("tab", "invites");
    } else {
      next.delete("tab");
    }
    setSearchParams(next, { replace: true });
  }

  async function handleCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      return;
    }
    await controller.createWorkspace(trimmed);
    setNewName("");
  }

  return (
    <section className="page-content workspace-manage-page">
      <div className="workspace-manage-header">
        <div>
          <h2>Workspaces</h2>
          <p className="muted-text">Switch, sort out access, and keep shared work areas tidy.</p>
        </div>
        <form className="workspace-create-inline" onSubmit={(event) => void handleCreate(event)}>
          <input
            id="workspace-create-input"
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New workspace"
            disabled={controller.isCreating}
          />
          <button className="btn primary" type="submit" disabled={controller.isCreating || !newName.trim()}>
            <Plus size={16} />
            {controller.isCreating ? "Creating" : "Create"}
          </button>
        </form>
      </div>

      {controller.isCreating ? <InlineProgressBar pin="top" /> : null}

      <div className="workspace-manage-toolbar">
        <label className="workbench-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspaces, owners, roles"
          />
        </label>
        <div className="segmented-control" role="tablist" aria-label="Workspace management sections">
          <button type="button" className={tab === "workspaces" ? "active" : ""} onClick={() => selectTab("workspaces")}>
            Workspaces
            <span>{controller.workspaces.length}</span>
          </button>
          <button type="button" className={tab === "invites" ? "active" : ""} onClick={() => selectTab("invites")}>
            Invites
            <span>{controller.invites.length}</span>
          </button>
        </div>
      </div>

      {controller.error ? <div className="error-banner">{controller.error}</div> : null}

      <section className="workspace-manage-surface">
        {controller.loading ? (
          <InlineProgressBar pin="top" />
        ) : tab === "workspaces" ? (
          <WorkspaceRows
            activeWorkspaceId={activeWorkspaceId}
            workspaces={visibleWorkspaces}
            state={controller}
            onOpen={controller.openWorkspace}
            onEditNameChange={controller.setEditName}
            onEditIconChange={controller.setEditIconKey}
            onSetEditingWorkspace={controller.setEditingWorkspace}
            onUpdate={(workspaceId) => void controller.updateWorkspace(workspaceId)}
            onDelete={(workspaceId, name) => void controller.deleteWorkspace(workspaceId, name)}
            onLeave={(workspace) => void controller.leaveWorkspace(workspace)}
            onToggleMembers={(workspaceId) => void controller.toggleMembers(workspaceId)}
            onRefreshMembers={(workspaceId) => void controller.loadWorkspaceMembers(workspaceId)}
          />
        ) : (
          <InviteRows
            invites={visibleInvites}
            state={controller}
            onAccept={(invite) => void controller.acceptInvite(invite)}
            onReject={(invite) => void controller.rejectInvite(invite)}
          />
        )}
      </section>
    </section>
  );
}
