import type { FunctionTool, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { createHash } from "node:crypto";
import { buildResponseTools, RUN_SHELL_MAX_TIMEOUT_SECONDS, type ResponseToolAvailability } from "../agent-tools/index.js";
import { buildCodeModeToolSet } from "../code-mode/code-mode-tools.js";
import type { TaskMessageToolOptions } from "./types.js";
import {
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
}

export function buildPromptCacheKey(taskId: string, promptPrefixHash: string): string {
  return createHash("sha256").update(`task:${taskId}:prefix:${promptPrefixHash}`).digest("hex");
}

export function buildAgentTurnRequest(input: {
  taskId: string;
  runToolOptions: TaskMessageToolOptions;
  activeSkillTools: FunctionTool[];
  promptEnvelope: PromptEnvelope;
  availability: ResponseToolAvailability;
  codeMode?: boolean;
}): AgentTurnRequest {
  const tools = buildResponseTools(input.runToolOptions, input.activeSkillTools, input.availability);
  const { responseTools, nestedTools } = input.codeMode === true
    ? buildCodeModeToolSet(tools, input.availability.runShellMaxTimeoutSeconds ?? RUN_SHELL_MAX_TIMEOUT_SECONDS)
    : { responseTools: tools, nestedTools: [] };
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
    promptCacheKey: buildPromptCacheKey(input.taskId, promptPrefixHash)
  };
}
