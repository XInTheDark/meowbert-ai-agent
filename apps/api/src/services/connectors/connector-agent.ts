export function normalizeConnectorAgentId(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function buildConnectorTaskAgentSelection(
  agentId: string | null | undefined
): { id: string } | undefined {
  const normalized = normalizeConnectorAgentId(agentId);
  return normalized ? { id: normalized } : undefined;
}
