import type { Workspace } from "../../lib/types";

export function normalizeWorkspaceSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function filterWorkspaces(workspaces: Workspace[], query: string): Workspace[] {
  const normalized = normalizeWorkspaceSearch(query);
  if (!normalized) {
    return workspaces;
  }

  return workspaces.filter((workspace) =>
    workspace.name.toLowerCase().includes(normalized)
      || workspace.role.toLowerCase().includes(normalized)
  );
}

// Workspaces arrive most recently opened first; keep that order and pin the active one on top.
export function sortWorkspaceOptions(workspaces: Workspace[], activeWorkspaceId: string): Workspace[] {
  const active = workspaces.filter((workspace) => workspace.id === activeWorkspaceId);
  return [...active, ...workspaces.filter((workspace) => workspace.id !== activeWorkspaceId)];
}
