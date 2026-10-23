import type { FunctionTool, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { createHash } from "node:crypto";
import { buildResponseTools, RUN_SHELL_MAX_TIMEOUT_SECONDS, type ResponseToolAvailability } from "../agent-tools/index.js";
import { buildCodeModeToolsPrompt, CODE_MODE_TOOLS_PROMPT_REASON } from "../code-mode/code-mode-prompt.js";
import { buildCodeModeToolSet } from "../code-mode/code-mode-tools.js";
import type { TaskMessageToolOptions } from "./types.js";
import {
  appendPromptEnvelopeDelta,
  computePromptPrefixHash,
  getPromptEnvelopeRevision,
  promptEnvelopeToPrefixItems,
  type PromptEnvelope
} from "./prompt-envelope.js";

export interface AgentTurnRequest {
  responseTools: Tool[];
  // Tools reachable through exec this turn; empty when code mode is off.
  codeModeTools: FunctionTool[];
  promptPrefixItems: ResponseInputItem[];
  promptPrefixHash: string;
  promptRevision: string;
  promptCacheKey: string;
  // Sent as x-session-affinity. Equal to the cache key except for swarm lanes, which share their
  // swarm's cache key but diverge from the leader's history, so session-resuming proxies keep them apart.
  sessionAffinityKey: string;
}

export function buildPromptCacheKey(taskId: string, promptPrefixHash: string): string {
  return createHash("sha256").update(`task:${taskId}:prefix:${promptPrefixHash}`).digest("hex");
}

function resolveTurnTools(input: {
  runToolOptions: TaskMessageToolOptions;
  activeSkillTools: FunctionTool[];
  availability: ResponseToolAvailability;
  codeMode?: boolean;
  fixedTools?: { response: Tool[]; codeMode: FunctionTool[] };
}): { responseTools: Tool[]; nestedTools: FunctionTool[] } {
  if (input.fixedTools) return { responseTools: input.fixedTools.response, nestedTools: input.fixedTools.codeMode };
  const tools = buildResponseTools(input.runToolOptions, input.activeSkillTools, input.availability);
  return input.codeMode === true
    ? buildCodeModeToolSet(tools, input.availability.runShellMaxTimeoutSeconds ?? RUN_SHELL_MAX_TIMEOUT_SECONDS)
    : { responseTools: tools, nestedTools: [] };
}

export function buildAgentTurnRequest(input: {
  taskId: string;
  // Keys the provider cache; a swarm lane uses its swarm's root task so every fork shares one cache.
  cacheTaskId?: string;
  runToolOptions: TaskMessageToolOptions;
  activeSkillTools: FunctionTool[];
  promptEnvelope: PromptEnvelope;
  availability: ResponseToolAvailability;
  codeMode?: boolean;
  // A swarm lane offers exactly the tools it was forked with.
  fixedTools?: { response: Tool[]; codeMode: FunctionTool[] };
}): AgentTurnRequest {
  const { responseTools, nestedTools } = resolveTurnTools(input);
  // Lands in the prefix before the envelope is sealed; later turns repeat the same content, which
  // the envelope skips, so the cached prefix stays put.
  if (nestedTools.length > 0) {
    appendPromptEnvelopeDelta(input.promptEnvelope, {
      reason: CODE_MODE_TOOLS_PROMPT_REASON,
      content: buildCodeModeToolsPrompt(nestedTools)
    });
  }
  const promptPrefixItems = promptEnvelopeToPrefixItems(input.promptEnvelope);
  const promptPrefixHash = computePromptPrefixHash({
    envelope: input.promptEnvelope,
    tools: responseTools
  });

  return {
    responseTools,
    codeModeTools: nestedTools,
    promptPrefixItems,
    promptPrefixHash,
    promptRevision: getPromptEnvelopeRevision(input.promptEnvelope),
    promptCacheKey: buildPromptCacheKey(input.cacheTaskId ?? input.taskId, promptPrefixHash),
    sessionAffinityKey: buildPromptCacheKey(input.taskId, promptPrefixHash)
  };
}
