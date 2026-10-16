function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMaybeJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractOutputTextFromMessageItem(item: Record<string, unknown>): string[] {
  const content = item.content;
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return null;
      }
      return typeof part.text === "string" && (part.type === "output_text" || part.type === "text")
        ? part.text
        : null;
    })
    .filter((part): part is string => typeof part === "string" && part.length > 0);
}

function extractFinalResponseText(item: Record<string, unknown>): string | null {
  if (item.type !== "function_call" || item.name !== "final_response" || typeof item.arguments !== "string") {
    return null;
  }

  const parsed = parseMaybeJson(item.arguments);
  return isRecord(parsed) && typeof parsed.response === "string" ? parsed.response : null;
}

function hasFinalResponseText(item: Record<string, unknown>): boolean {
  return item.type === "function_call" && item.name === "final_response" && typeof item.arguments === "string";
}

function extractFinalResponseTexts(responseItems: unknown[]): string[] {
  const finalResponseTexts: string[] = [];
  for (const item of responseItems) {
    if (!isRecord(item) || !hasFinalResponseText(item)) {
      continue;
    }

    const finalResponseText = extractFinalResponseText(item);
    if (finalResponseText && finalResponseText.trim().length > 0) {
      finalResponseTexts.push(finalResponseText.trim());
    }
  }

  return finalResponseTexts;
}

// The text a response's items deliver, for messages that carry no stored text of their own.
export function extractResponseItemsText(responseItems: unknown[]): string {
  const finalResponseTexts = extractFinalResponseTexts(responseItems);
  if (finalResponseTexts.length > 0) {
    return finalResponseTexts[finalResponseTexts.length - 1];
  }

  const textParts: string[] = [];
  for (const item of responseItems) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === "message") {
      textParts.push(...extractOutputTextFromMessageItem(item));
      continue;
    }

    if (item.type === "output_text" && typeof item.text === "string") {
      textParts.push(item.text);
      continue;
    }

  }

  return textParts.join("\n\n");
}

