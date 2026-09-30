const DEFAULT_SANDBOX_UID = 1000;
const DEFAULT_SANDBOX_GID = 0;

export interface SandboxContainerIdentity {
  user: string;
  groupAdd?: string[];
  requiresWritableMountNormalization: boolean;
}

export function normalizeGroupIds(groupIds: number[]): number[] {
  return [...new Set(groupIds.filter((groupId) => Number.isInteger(groupId) && groupId >= 0))];
}

export function resolveSandboxContainerIdentity(input: {
  processUid: number | null;
  processGid: number | null;
  writableMountGids: number[];
  runAsRoot?: boolean;
}): SandboxContainerIdentity {
  const writableMountGids = normalizeGroupIds(input.writableMountGids);
  if (input.runAsRoot === true) {
    const primaryGroupId = writableMountGids[0]
      ?? (typeof input.processGid === "number" && input.processGid >= 0 ? input.processGid : DEFAULT_SANDBOX_GID);
    const groupAdd = writableMountGids
      .filter((groupId) => groupId !== primaryGroupId)
      .map((groupId) => `${groupId}`);

    return {
      user: `0:${primaryGroupId}`,
      ...(groupAdd.length > 0 ? { groupAdd } : {}),
      requiresWritableMountNormalization: writableMountGids.length > 0
    };
  }

  if (typeof input.processUid === "number" && input.processUid > 0) {
    const resolvedGid =
      typeof input.processGid === "number" && input.processGid >= 0
        ? input.processGid
        : input.processUid;
    return {
      user: `${input.processUid}:${resolvedGid}`,
      requiresWritableMountNormalization: false
    };
  }

  const primaryGroupId = writableMountGids[0]
    ?? (typeof input.processGid === "number" && input.processGid >= 0 ? input.processGid : DEFAULT_SANDBOX_GID);
  const groupAdd = writableMountGids
    .filter((groupId) => groupId !== primaryGroupId)
    .map((groupId) => `${groupId}`);

  return {
    user: `${DEFAULT_SANDBOX_UID}:${primaryGroupId}`,
    ...(groupAdd.length > 0 ? { groupAdd } : {}),
    requiresWritableMountNormalization: true
  };
}
