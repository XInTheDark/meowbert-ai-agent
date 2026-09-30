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

export function sortWorkspaceOptions(workspaces: Workspace[], activeWorkspaceId: string): Workspace[] {
  return [...workspaces].sort((left, right) => {
    if (left.id === activeWorkspaceId) {
      return -1;
    }
    if (right.id === activeWorkspaceId) {
      return 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}
