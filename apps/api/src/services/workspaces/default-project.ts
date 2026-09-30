import { createEnvironment, type CreatedEnvironment } from "../environments/environment-creation.js";

const DEFAULT_PROJECT_NAME = "My Project";

interface BuildDefaultProjectNameInput {
  displayName?: string | null;
  workspaceName?: string | null;
}

interface CreateDefaultProjectForWorkspaceInput extends BuildDefaultProjectNameInput {
  workspaceId: string;
  userId: string;
}

function normalizeProjectBaseName(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\s+workspace$/i, "").trim() || null;
}

export function buildDefaultProjectName(input: BuildDefaultProjectNameInput): string {
  const workspaceBaseName = normalizeProjectBaseName(input.workspaceName);
  if (workspaceBaseName) {
    return `${workspaceBaseName} Project`;
  }

  const displayName = normalizeProjectBaseName(input.displayName);
  if (displayName) {
    return `${displayName} Project`;
  }

  return DEFAULT_PROJECT_NAME;
}

export async function createDefaultProjectForWorkspace(
  input: CreateDefaultProjectForWorkspaceInput
): Promise<CreatedEnvironment> {
  return createEnvironment({
    workspaceId: input.workspaceId,
    name: buildDefaultProjectName(input),
    createdByUserId: input.userId
  });
}
