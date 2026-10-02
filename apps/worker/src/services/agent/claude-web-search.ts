import { randomUUID } from "node:crypto";
import type { PlatformUsageBilling } from "@meowbert/shared";
import type { OpenAiProviderConfig } from "./openai-client.js";
import { createModelResponse } from "./model.js";
import { platformUsageRecorder } from "../tasks/platform-usage.js";

// Meridian's cherry adapter runs in internal mode with the Agent SDK's own WebSearch/WebFetch
// enabled, so the search runs on the Claude subscription. The hosted web_search tool is API-billed
// and Meridian rejects it. Every proxy hop must forward this header (see the admin guide).
const MERIDIAN_SEARCH_AGENT_HEADER = { "x-meridian-agent": "cherry" };

const SEARCH_INSTRUCTIONS =
  "Search the web to answer the request. Reply with a concise, factual answer followed by the URLs of the sources you used.";

export async function runClaudeWebSearch(input: {
  provider: OpenAiProviderConfig;
  billing: PlatformUsageBilling | null;
  model: string;
  query: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const response = await createModelResponse({
    provider: {
      ...input.provider,
      defaultHeaders: { ...(input.provider.defaultHeaders ?? {}), ...MERIDIAN_SEARCH_AGENT_HEADER }
    },
    model: input.model,
    modelType: "claude",
    abortSignal: input.abortSignal,
    // A unique key gives each search its own session, so it never resumes a task's conversation.
    promptCacheKey: `web-search:${randomUUID()}`,
    prefixItems: [{ role: "developer", content: SEARCH_INSTRUCTIONS }],
    conversationItems: [{ role: "user", content: input.query }],
    modelPayload: {},
    tools: [],
    toolChoice: "auto",
    parallelToolCalls: false
  });
  await platformUsageRecorder.recordResponseUsage(input.billing, input.model, response.usage);
  const answer = response.output_text.trim();
  if (answer.length === 0) {
    throw new Error("The search returned no answer.");
  }
  return answer;
}
