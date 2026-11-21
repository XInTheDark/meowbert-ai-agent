import { randomUUID } from "node:crypto";
import type { PlatformModelType } from "@meowbert/shared";
import { WEB_SEARCH_TOOL } from "../agent-tools/function-tools.js";
import { runClaudeWebSearch } from "../agent/claude-web-search.js";
import { createModelResponse } from "../agent/model.js";
import type { ModelGateway } from "../agent/ports/model-gateway.js";

const BRIDGE_SEARCH_INSTRUCTIONS =
  "Search the web to answer the request. Reply with a concise, factual answer followed by the URLs of the sources you used.";

export async function runBridgeWebSearch(input: {
  models: ModelGateway;
  chatGptCodex: boolean;
  modelType: PlatformModelType;
  query: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  if (input.modelType === "claude") {
    return runClaudeWebSearch({
      models: input.models,
      chatGptCodex: input.chatGptCodex,
      query: input.query,
      abortSignal: input.abortSignal
    });
  }

  const { response } = await createModelResponse({
    models: input.models,
    purpose: "web_search",
    chatGptCodex: input.chatGptCodex,
    modelType: input.modelType,
    abortSignal: input.abortSignal,
    promptCacheKey: `bridge-web-search:${randomUUID()}`,
    prefixItems: [{ role: "developer", content: BRIDGE_SEARCH_INSTRUCTIONS }],
    conversationItems: [{ role: "user", content: input.query }],
    modelPayload: {},
    tools: [WEB_SEARCH_TOOL],
    toolChoice: "auto",
    parallelToolCalls: false
  });
  const answer = response.output_text.trim();
  if (answer.length === 0) {
    throw new Error("The search returned no answer.");
  }
  return answer;
}
