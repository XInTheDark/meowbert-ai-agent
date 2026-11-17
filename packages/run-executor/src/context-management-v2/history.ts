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

// Seeds rebuilt from task messages lack fields the live run recorded (call numbers, status), and their
// order can differ from the window's, so items with their own identity are matched by it rather than
// by position: tool items by provider call id, reasoning by its signed content. The window keeps the copy
// the provider saw; replacing or repeating it would change the cached prefix.
function identityKey(item: ResponseInputItem): string | null {
  if (isToolCallItem(item) || isToolOutputItem(item)) {
    return `${(item as { type: string }).type}:${getProviderCallId(item)}`;
  }
  const record = item as { type?: unknown; encrypted_content?: unknown };
  if (record.type === "reasoning" && typeof record.encrypted_content === "string" && record.encrypted_content.length > 0) {
    return `reasoning:${record.encrypted_content}`;
  }
  return null;
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
  const existingIdentityKeys = new Set(existing.map(identityKey).filter((key) => key !== null));
  const newItems: ResponseInputItem[] = [];
  let existingIndex = 0;

  for (const seedItem of seedItems) {
    const ownKey = identityKey(seedItem);
    // These keys are unique, and parallel calls may be ordered differently in the seed.
    if (ownKey !== null && existingIdentityKeys.has(ownKey)) {
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
