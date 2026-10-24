import type { ResponseInputItem } from "openai/resources/responses/responses";

const OPAQUE_ITEM_MARKER = /\n\[id: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i;

function normalizeForComparison(value: unknown, fieldName?: string): unknown {
  if (typeof value === "string") {
    return fieldName === "content" || fieldName === "output"
      ? value.replace(OPAQUE_ITEM_MARKER, "")
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForComparison(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeForComparison(entry, key)])
  );
}

function itemKey(item: ResponseInputItem): string {
  return JSON.stringify(normalizeForComparison(item));
}

export function mergeContextSeedItems(existing: ResponseInputItem[], seedItems: ResponseInputItem[]): {
  conversationItems: ResponseInputItem[];
  newItems: ResponseInputItem[];
} {
  const positionsByKey = new Map<string, { indices: number[]; cursor: number }>();
  existing.forEach((item, index) => {
    const key = itemKey(item);
    const positions = positionsByKey.get(key) ?? { indices: [], cursor: 0 };
    positions.indices.push(index);
    positionsByKey.set(key, positions);
  });
  const newItems: ResponseInputItem[] = [];
  let existingIndex = 0;

  for (const seedItem of seedItems) {
    const positions = positionsByKey.get(itemKey(seedItem));
    while (positions && positions.cursor < positions.indices.length && positions.indices[positions.cursor] < existingIndex) {
      positions.cursor += 1;
    }
    if (!positions || positions.cursor === positions.indices.length) {
      newItems.push(seedItem);
      continue;
    }
    existingIndex = positions.indices[positions.cursor] + 1;
    positions.cursor += 1;
  }

  return {
    conversationItems: [...existing, ...newItems],
    newItems
  };
}
