import type { ResponseInputItem } from "openai/resources/responses/responses";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPreservedOpaqueReasoningField(key: string, value: unknown): boolean {
  return (
    (key === "encrypted_content" || key === "thought_signature" || key === "thoughtSignature")
    && typeof value === "string"
    && value.length > 0
  );
}

function countPreservedOpaqueReasoningFields(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((count, entry) => count + countPreservedOpaqueReasoningFields(entry), 0);
  }

  if (!isRecord(value)) {
    return 0;
  }

  return Object.entries(value).reduce((count, [key, entry]) => {
    if (isPreservedOpaqueReasoningField(key, entry)) {
      return count + 1;
    }

    return count + countPreservedOpaqueReasoningFields(entry);
  }, 0);
}

export function countPreservedReasoningContentItems(items: ResponseInputItem[]): number {
  return items.reduce((count, item) => count + countPreservedOpaqueReasoningFields(item), 0);
}
