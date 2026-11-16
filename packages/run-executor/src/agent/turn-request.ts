import type { FunctionTool, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { createHash } from "node:crypto";
import { buildResponseTools, RUN_SHELL_MAX_TIMEOUT_SECONDS, type ResponseToolAvailability } from "../agent-tools/index.js";
import { buildCodeModeToolsPrompt, CODE_MODE_TOOLS_PROMPT_REASON } from "../code-mode/code-mode-prompt.js";
import { buildCodeModeToolSet } from "../code-mode/code-mode-tools.js";
import { isToolGroupTool } from "../agent-tools/tool-groups.js";
import type { TaskMessageToolOptions } from "./types.js";
import {
  appendPromptEnvelopeDelta,
  computePromptPrefixHash,
  getPromptEnvelopeRevision,
  promptEnvelopeToPrefixItems,
  type PromptEnvelope
} from "./prompt-envelope.js";

export interface AgentTurnRequest {
  // The tool definitions sent. A context window keeps its first ones, so they can list tools this run
  // no longer allows.
  responseTools: Tool[];
  // The top-level tools this run allows.
  availableResponseTools: Tool[];
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

function toolKey(tool: Tool): string {
  return tool.type + ":" + ("name" in tool && typeof tool.name === "string" ? tool.name : "");
}

function resolveTurnTools(input: {
  runToolOptions: TaskMessageToolOptions;
  activeSkillTools: FunctionTool[];
  availability: ResponseToolAvailability;
  codeMode?: boolean;
  fixedTools?: { response: Tool[]; codeMode: FunctionTool[] };
}): { responseTools: Tool[]; availableResponseTools: Tool[]; nestedTools: FunctionTool[] } {
  const tools = buildResponseTools(input.runToolOptions, input.activeSkillTools, input.availability);
  const maxTimeoutSeconds = input.availability.runShellMaxTimeoutSeconds ?? RUN_SHELL_MAX_TIMEOUT_SECONDS;
  if (input.fixedTools) {
    // The fork's definitions stay for its cache; only the ones this run still has may be called.
    const current = input.codeMode === true ? buildCodeModeToolSet(tools, maxTimeoutSeconds).responseTools : tools;
    const currentKeys = new Set(current.map(toolKey));
    const kept = input.fixedTools.response.filter((tool) => currentKeys.has(toolKey(tool)));
    const inheritedNames = new Set([...input.fixedTools.response, ...input.fixedTools.codeMode]
      .filter((tool): tool is FunctionTool => tool.type === "function").map((tool) => tool.name));
    const skillNames = new Set(input.activeSkillTools.map((tool) => tool.name));
    const additions = tools.filter((tool): tool is FunctionTool => tool.type === "function"
      && !inheritedNames.has(tool.name) && (skillNames.has(tool.name) || isToolGroupTool(tool.name)));
    if (additions.length === 0) {
      return { responseTools: input.fixedTools.response, availableResponseTools: kept, nestedTools: input.fixedTools.codeMode };
    }
    const added = input.codeMode === true
      ? buildCodeModeToolSet(additions, maxTimeoutSeconds)
      : { responseTools: additions, nestedTools: [] };
    const addedResponseTools = added.responseTools.filter((tool) => tool.type !== "function" || !inheritedNames.has(tool.name));
    return {
      responseTools: [...input.fixedTools.response, ...addedResponseTools],
      availableResponseTools: [...kept, ...addedResponseTools],
      nestedTools: [...input.fixedTools.codeMode, ...added.nestedTools]
    };
  }
  const built = input.codeMode === true
    ? buildCodeModeToolSet(tools, maxTimeoutSeconds)
    : { responseTools: tools, nestedTools: [] };
  return { ...built, availableResponseTools: built.responseTools };
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
  // Preserve the fork's tools, adding skills and tool groups enabled inside the lane.
  fixedTools?: { response: Tool[]; codeMode: FunctionTool[] };
}): AgentTurnRequest {
  const { responseTools, availableResponseTools, nestedTools } = resolveTurnTools(input);
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
    availableResponseTools,
    codeModeTools: nestedTools,
    promptPrefixItems,
    promptPrefixHash,
    promptRevision: getPromptEnvelopeRevision(input.promptEnvelope),
    promptCacheKey: buildPromptCacheKey(input.cacheTaskId ?? input.taskId, promptPrefixHash),
    sessionAffinityKey: buildPromptCacheKey(input.taskId, promptPrefixHash)
  };
}
