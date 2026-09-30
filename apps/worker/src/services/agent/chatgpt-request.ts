import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { OpenAiProviderConfig } from "./openai-client.js";

export const CHATGPT_CODEX_ORIGINATOR = "meowbert";

export function isChatGptCodexProvider(provider: OpenAiProviderConfig): boolean {
  return provider.chatGptCodex === true;
}

export function buildChatGptCodexProvider(
  provider: OpenAiProviderConfig,
  sessionId?: string
): OpenAiProviderConfig {
  if (!isChatGptCodexProvider(provider) || !sessionId) {
    return provider;
  }

  return {
    ...provider,
    defaultHeaders: {
      ...(provider.defaultHeaders ?? {}),
      "session-id": sessionId,
      "x-client-request-id": sessionId
    }
  };
}

function readTextContent(item: ResponseInputItem): string {
  const content = (item as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter((text) => text.length > 0)
    .join("");
}

export function buildChatGptCodexInstructions(prefixItems: ResponseInputItem[]): string {
  return prefixItems
    .map(readTextContent)
    .map((content) => content.trim())
    .filter((content) => content.length > 0)
    .join("\n\n");
}
