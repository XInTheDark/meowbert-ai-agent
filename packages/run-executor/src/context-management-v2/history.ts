import type { ResponseInputItem } from "openai/resources/responses/responses";
import { getProviderCallId, isToolCallItem, isToolOutputItem } from "./call-numbers.js";

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

// Seeds rebuilt from task messages lack fields the live run recorded (call numbers, status), so tool
// items are matched by provider call id. The window keeps the copy the provider saw; replacing it
// would change the cached prefix.
function toolItemKey(item: ResponseInputItem): string | null {
  if (!isToolCallItem(item) && !isToolOutputItem(item)) return null;
  return `${(item as { type: string }).type}:${getProviderCallId(item)}`;
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
  const existingToolKeys = new Set(existing.map(toolItemKey).filter((key) => key !== null));
  const newItems: ResponseInputItem[] = [];
  let existingIndex = 0;

  for (const seedItem of seedItems) {
    const toolKey = toolItemKey(seedItem);
    // Call ids are unique, and parallel calls may be ordered differently in the seed.
    if (toolKey !== null && existingToolKeys.has(toolKey)) {
      continue;
    }
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
