const MAX_MODEL_SLIDER_AGENT_IDS = 100;

export function normalizeModelSliderAgentIds(rawValue: unknown): string[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rawId of rawValue.slice(0, MAX_MODEL_SLIDER_AGENT_IDS)) {
    if (typeof rawId !== "string") {
      continue;
    }

    const id = rawId.trim();
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}
