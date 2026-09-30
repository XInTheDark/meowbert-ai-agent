import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DEFAULT_WORKSPACE_ICON_KEY,
  normalizeWorkspaceIconKey,
  type WorkspaceIconKey
} from "@meowbert/shared/workspace-icons";
import type { ApiClient } from "../../../lib/api";
import { saveLastWorkspaceId } from "../layout/utils";
import type {
  WorkspaceInviteAcceptResponse,
  WorkspaceInviteListResponse,
  WorkspaceListItem,
  WorkspaceListResponse,
  WorkspaceManageState,
  WorkspaceMembersResponse
} from "./workspaceManageTypes";
import type { WorkspaceInviteDetail, WorkspaceInviteSummary } from "../../../lib/types";

interface UseWorkspaceManageControllerInput {
  api: ApiClient;
  activeWorkspaceId: string;
  setFlash: (flash: { tone: "success" | "error"; text: string } | null) => void;
  onWorkspaceListChanged?: () => Promise<void>;
}

export interface WorkspaceManageController extends WorkspaceManageState {
  setEditName: (value: string) => void;
  setEditIconKey: (value: WorkspaceIconKey) => void;
  setEditingWorkspace: (workspace: WorkspaceListItem | null) => void;
  loadWorkspaceData: () => Promise<void>;
  loadWorkspaceMembers: (workspaceId: string) => Promise<void>;
  toggleMembers: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  updateWorkspace: (id: string) => Promise<void>;
  deleteWorkspace: (id: string, name: string) => Promise<void>;
  leaveWorkspace: (workspace: WorkspaceListItem) => Promise<void>;
  acceptInvite: (invite: WorkspaceInviteSummary) => Promise<void>;
  rejectInvite: (invite: WorkspaceInviteSummary) => Promise<void>;
  openWorkspace: (workspaceId: string) => void;
}

function retainRecordKeys<T>(items: Array<{ id: string }>, current: Record<string, T>): Record<string, T> {
  return Object.fromEntries(items
    .filter((item) => current[item.id] !== undefined)
    .map((item) => [item.id, current[item.id]]));
}

function normalizeWorkspaceItem(workspace: WorkspaceListItem): WorkspaceListItem {
  return {
    ...workspace,
    iconKey: normalizeWorkspaceIconKey(workspace.iconKey),
    projectCount: workspace.projectCount ?? workspace.environmentCount ?? 0
  };
}

export function useWorkspaceManageController(input: UseWorkspaceManageControllerInput): WorkspaceManageController {
  const navigate = useNavigate();
  const { activeWorkspaceId, api, onWorkspaceListChanged, setFlash } = input;
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [invites, setInvites] = useState<WorkspaceInviteSummary[]>([]);
  const [inviteDetailsById, setInviteDetailsById] = useState<Record<string, WorkspaceInviteDetail>>({});
  const [inviteDetailErrorsById, setInviteDetailErrorsById] = useState<Record<string, string>>({});
  const [inviteDetailLoadingById, setInviteDetailLoadingById] = useState<Record<string, boolean>>({});
  const [workspaceMembersById, setWorkspaceMembersById] = useState<WorkspaceManageState["workspaceMembersById"]>({});
  const [workspaceMembersErrorById, setWorkspaceMembersErrorById] = useState<Record<string, string>>({});
  const [workspaceMembersLoadingById, setWorkspaceMembersLoadingById] = useState<Record<string, boolean>>({});
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIconKey, setEditIconKey] = useState<WorkspaceIconKey>(DEFAULT_WORKSPACE_ICON_KEY);
  const [error, setError] = useState<string | null>(null);
  const [inviteDecisionId, setInviteDecisionId] = useState<string | null>(null);
  const [leavingWorkspaceId, setLeavingWorkspaceId] = useState<string | null>(null);

  const loadWorkspaceData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [workspaceResponse, inviteResponse] = await Promise.all([
        api.get<WorkspaceListResponse>("/api/workspaces"),
        api.get<WorkspaceInviteListResponse>("/api/workspace-invites")
      ]);
      setWorkspaces(workspaceResponse.items.map((workspace) => normalizeWorkspaceItem(workspace)));
      setInvites(inviteResponse.items);
      setInviteDetailsById((current) => retainRecordKeys(inviteResponse.items, current));
      setInviteDetailErrorsById((current) => retainRecordKeys(inviteResponse.items, current));
      setInviteDetailLoadingById((current) => retainRecordKeys(inviteResponse.items, current));
      setExpandedWorkspaceIds((current) => retainRecordKeys(workspaceResponse.items, current));
      setWorkspaceMembersById((current) => retainRecordKeys(workspaceResponse.items, current));
      setWorkspaceMembersErrorById((current) => retainRecordKeys(workspaceResponse.items, current));
      setWorkspaceMembersLoadingById((current) => retainRecordKeys(workspaceResponse.items, current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  useEffect(() => {
    const missingInviteIds = invites
      .map((invite) => invite.id)
      .filter((inviteId) => !inviteDetailsById[inviteId] && !inviteDetailLoadingById[inviteId] && !inviteDetailErrorsById[inviteId]);

    if (missingInviteIds.length === 0) {
      return;
    }

    let cancelled = false;
    setInviteDetailLoadingById((current) => ({
      ...current,
      ...Object.fromEntries(missingInviteIds.map((inviteId) => [inviteId, true]))
    }));

    void Promise.all(missingInviteIds.map(async (inviteId) => {
      try {
        const detail = await api.get<WorkspaceInviteDetail>(`/api/workspace-invites/${inviteId}`);
        if (cancelled) {
          return;
        }
        setInviteDetailsById((current) => ({ ...current, [inviteId]: detail }));
        setInviteDetailErrorsById((current) => {
          const next = { ...current };
          delete next[inviteId];
          return next;
        });
      } catch (err) {
        if (cancelled) {
          return;
        }
        setInviteDetailErrorsById((current) => ({
          ...current,
          [inviteId]: err instanceof Error ? err.message : String(err)
        }));
      } finally {
        if (!cancelled) {
          setInviteDetailLoadingById((current) => ({ ...current, [inviteId]: false }));
        }
      }
    }));

    return () => {
      cancelled = true;
    };
  }, [api, inviteDetailErrorsById, inviteDetailLoadingById, inviteDetailsById, invites]);

  const loadWorkspaceMembers = useCallback(async (workspaceId: string): Promise<void> => {
    setWorkspaceMembersLoadingById((current) => ({ ...current, [workspaceId]: true }));
    setWorkspaceMembersErrorById((current) => {
      const next = { ...current };
      delete next[workspaceId];
      return next;
    });
    try {
      const response = await api.get<WorkspaceMembersResponse>(`/api/workspaces/${workspaceId}/members`);
      setWorkspaceMembersById((current) => ({ ...current, [workspaceId]: response.items }));
    } catch (err) {
      setWorkspaceMembersErrorById((current) => ({
        ...current,
        [workspaceId]: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      setWorkspaceMembersLoadingById((current) => ({ ...current, [workspaceId]: false }));
    }
  }, [api]);

  const toggleMembers = useCallback(async (workspaceId: string): Promise<void> => {
    const isExpanded = expandedWorkspaceIds[workspaceId] === true;
    setExpandedWorkspaceIds((current) => ({
      ...current,
      [workspaceId]: !isExpanded
    }));

    if (!isExpanded && !workspaceMembersById[workspaceId] && !workspaceMembersLoadingById[workspaceId]) {
      await loadWorkspaceMembers(workspaceId);
    }
  }, [expandedWorkspaceIds, loadWorkspaceMembers, workspaceMembersById, workspaceMembersLoadingById]);

  const openWorkspace = useCallback((workspaceId: string): void => {
    saveLastWorkspaceId(workspaceId);
    navigate(`/app/${workspaceId}/projects`);
  }, [navigate]);

  const createWorkspace = useCallback(async (name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const response = await api.post<{ id: string; name: string; iconKey?: string }>("/api/workspaces", { name: trimmed });
      setFlash({ tone: "success", text: "Workspace created." });
      await loadWorkspaceData();
      await onWorkspaceListChanged?.();
      openWorkspace(response.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }, [api, loadWorkspaceData, onWorkspaceListChanged, openWorkspace, setFlash]);

  const updateWorkspace = useCallback(async (id: string): Promise<void> => {
    const trimmed = editName.trim();
    if (!trimmed) {
      return;
    }

    try {
      await api.patch(`/api/workspaces/${id}`, { name: trimmed, iconKey: editIconKey });
      setFlash({ tone: "success", text: "Workspace updated." });
      setEditingId(null);
      await loadWorkspaceData();
      await onWorkspaceListChanged?.();
    } catch (err) {
      setFlash({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }, [api, editIconKey, editName, loadWorkspaceData, onWorkspaceListChanged, setFlash]);

  const deleteWorkspace = useCallback(async (id: string, name: string): Promise<void> => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await api.delete(`/api/workspaces/${id}`);
      setFlash({ tone: "success", text: "Workspace deleted." });
      await loadWorkspaceData();
      await onWorkspaceListChanged?.();
      if (id === activeWorkspaceId) {
        const nextWorkspace = workspaces.find((workspace) => workspace.id !== id);
        if (nextWorkspace) {
          openWorkspace(nextWorkspace.id);
        }
      }
    } catch (err) {
      setFlash({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }, [activeWorkspaceId, api, loadWorkspaceData, onWorkspaceListChanged, openWorkspace, setFlash, workspaces]);

  const leaveWorkspace = useCallback(async (workspace: WorkspaceListItem): Promise<void> => {
    if (!confirm(`Leave "${workspace.name}"? You will lose access to its chats, files, tasks, and notifications.`)) {
      return;
    }

    setLeavingWorkspaceId(workspace.id);
    try {
      await api.delete(`/api/workspaces/${workspace.id}/membership`);
      setFlash({ tone: "success", text: `Left ${workspace.name}.` });
      await loadWorkspaceData();
      await onWorkspaceListChanged?.();
      if (workspace.id === activeWorkspaceId) {
        const nextWorkspace = workspaces.find((item) => item.id !== workspace.id);
        if (nextWorkspace) {
          openWorkspace(nextWorkspace.id);
        }
      }
    } catch (err) {
      setFlash({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLeavingWorkspaceId(null);
    }
  }, [activeWorkspaceId, api, loadWorkspaceData, onWorkspaceListChanged, openWorkspace, setFlash, workspaces]);

  const acceptInvite = useCallback(async (invite: WorkspaceInviteSummary): Promise<void> => {
    setInviteDecisionId(invite.id);
    try {
      const response = await api.post<WorkspaceInviteAcceptResponse>(`/api/workspace-invites/${invite.id}/accept`);
      setFlash({
        tone: "success",
        text: response.createdMembership
          ? `Joined ${response.workspaceName}.`
          : `${response.workspaceName} is already available.`
      });
      await loadWorkspaceData();
      await onWorkspaceListChanged?.();
      openWorkspace(response.workspaceId);
    } catch (err) {
      setFlash({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setInviteDecisionId(null);
    }
  }, [api, loadWorkspaceData, onWorkspaceListChanged, openWorkspace, setFlash]);

  const rejectInvite = useCallback(async (invite: WorkspaceInviteSummary): Promise<void> => {
    setInviteDecisionId(invite.id);
    try {
      const response = await api.post<{ workspaceName: string }>(`/api/workspace-invites/${invite.id}/reject`);
      setFlash({ tone: "success", text: `Declined invite to ${response.workspaceName}.` });
      await loadWorkspaceData();
    } catch (err) {
      setFlash({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setInviteDecisionId(null);
    }
  }, [api, loadWorkspaceData, setFlash]);

  const setEditingWorkspace = useCallback((workspace: WorkspaceListItem | null): void => {
    setEditingId(workspace?.id ?? null);
    setEditName(workspace?.name ?? "");
    setEditIconKey(normalizeWorkspaceIconKey(workspace?.iconKey));
  }, []);

  return useMemo(() => ({
    workspaces,
    invites,
    inviteDetailsById,
    inviteDetailErrorsById,
    inviteDetailLoadingById,
    workspaceMembersById,
    workspaceMembersErrorById,
    workspaceMembersLoadingById,
    expandedWorkspaceIds,
    loading,
    isCreating,
    error,
    editingId,
    editName,
    editIconKey,
    inviteDecisionId,
    leavingWorkspaceId,
    setEditName,
    setEditIconKey,
    setEditingWorkspace,
    loadWorkspaceData,
    loadWorkspaceMembers,
    toggleMembers,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    leaveWorkspace,
    acceptInvite,
    rejectInvite,
    openWorkspace
  }), [
    acceptInvite,
    createWorkspace,
    deleteWorkspace,
    editIconKey,
    editName,
    editingId,
    error,
    expandedWorkspaceIds,
    inviteDecisionId,
    inviteDetailErrorsById,
    inviteDetailLoadingById,
    inviteDetailsById,
    invites,
    isCreating,
    leavingWorkspaceId,
    leaveWorkspace,
    loadWorkspaceData,
    loadWorkspaceMembers,
    loading,
    openWorkspace,
    rejectInvite,
    setEditingWorkspace,
    toggleMembers,
    updateWorkspace,
    workspaceMembersById,
    workspaceMembersErrorById,
    workspaceMembersLoadingById,
    workspaces
  ]);
}
