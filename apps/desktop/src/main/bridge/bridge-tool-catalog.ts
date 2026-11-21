import type { FunctionTool } from "openai/resources/responses/responses";
import { BRIDGE_MAX_RUN_SHELL_TIMEOUT_SECONDS, type BridgeToolMode } from "@meowbert/shared";
import {
  buildRunShellFunctionTool,
  buildWaitFunctionTool,
  ENABLE_SKILL_TOOL_NAME,
  FINAL_RESPONSE_TOOL_NAME,
  LIST_SKILLS_TOOL_NAME,
  MARK_ARTIFACT_TOOL_NAME,
  MEMORY_SEARCH_TOOL_NAME,
  RESPONSE_FUNCTION_TOOLS,
  RUN_SHELL_TOOL_NAME,
  SEARCH_WEB_TOOL,
  SEND_MESSAGE_TOOL_NAME,
  SHELL_SESSION_TOOL_NAME,
  STOP_TASK_TOOL_NAME,
  UPDATE_PROGRESS_TOOL,
  VIEW_IMAGE_TOOL_NAME,
  VIEW_PDF_FILE_TOOL_NAME,
  WAIT_TOOL_NAME
} from "@meowbert/run-executor/agent-tools/index";

export interface StaticMcpToolSpec {
  mcpName: string;
  meowbertToolName?: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const SESSION_CODE_PROP = {
  session_code: {
    type: "string",
    description: "The Meowbert bridge session code from the handoff prompt (e.g. mb_1a2b3c4d)."
  }
};

function requireBuiltinTool(name: string): FunctionTool {
  const tool = RESPONSE_FUNCTION_TOOLS.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Missing built-in executor tool definition for "${name}".`);
  }
  return tool;
}

function wrapExecutorTool(mcpName: string, tool: FunctionTool): StaticMcpToolSpec {
  const params = (tool.parameters ?? {}) as Record<string, unknown>;
  const existingProperties = params.properties && typeof params.properties === "object"
    ? params.properties as Record<string, unknown>
    : {};
  const existingRequired = Array.isArray(params.required)
    ? params.required.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    mcpName,
    meowbertToolName: tool.name,
    description: tool.description ?? `Meowbert tool ${tool.name}`,
    inputSchema: {
      ...params,
      type: "object",
      properties: { ...SESSION_CODE_PROP, ...existingProperties },
      required: ["session_code", ...existingRequired],
      additionalProperties: false
    }
  };
}

export const BRIDGE_META_TOOLS: StaticMcpToolSpec[] = [
  {
    mcpName: "meowbert_start",
    description: "Claim a waiting Meowbert bridge session and receive the full task instructions, conversation history, strict-proxy rules, and available tools.",
    inputSchema: {
      type: "object",
      properties: SESSION_CODE_PROP,
      required: ["session_code"],
      additionalProperties: false
    }
  },
  {
    mcpName: "meowbert_list_tools",
    description: "List every Meowbert tool currently enabled for this bridge session along with its JSON schema.",
    inputSchema: {
      type: "object",
      properties: SESSION_CODE_PROP,
      required: ["session_code"],
      additionalProperties: false
    }
  },
  {
    mcpName: "meowbert_call_tool",
    description: "Invoke any enabled Meowbert tool by name (including skills, live Drive sync, canvas, scheduling, and workflow tools).",
    inputSchema: {
      type: "object",
      properties: {
        ...SESSION_CODE_PROP,
        tool_name: { type: "string", description: "Exact Meowbert tool name from meowbert_list_tools." },
        arguments: { type: "object", description: "Arguments object for the Meowbert tool.", additionalProperties: true }
      },
      required: ["session_code", "tool_name"],
      additionalProperties: false
    }
  }
];

export const BRIDGE_CORE_PROXY_TOOLS: StaticMcpToolSpec[] = [
  wrapExecutorTool(`meowbert_${RUN_SHELL_TOOL_NAME}`, buildRunShellFunctionTool(BRIDGE_MAX_RUN_SHELL_TIMEOUT_SECONDS)),
  wrapExecutorTool(`meowbert_${SHELL_SESSION_TOOL_NAME}`, requireBuiltinTool(SHELL_SESSION_TOOL_NAME)),
  wrapExecutorTool(`meowbert_${VIEW_IMAGE_TOOL_NAME}`, requireBuiltinTool(VIEW_IMAGE_TOOL_NAME)),
  wrapExecutorTool(`meowbert_${VIEW_PDF_FILE_TOOL_NAME}`, requireBuiltinTool(VIEW_PDF_FILE_TOOL_NAME)),
  wrapExecutorTool(`meowbert_${MARK_ARTIFACT_TOOL_NAME}`, requireBuiltinTool(MARK_ARTIFACT_TOOL_NAME)),
  wrapExecutorTool("meowbert_update_progress", UPDATE_PROGRESS_TOOL),
  wrapExecutorTool(`meowbert_${SEND_MESSAGE_TOOL_NAME}`, requireBuiltinTool(SEND_MESSAGE_TOOL_NAME)),
  wrapExecutorTool(`meowbert_${FINAL_RESPONSE_TOOL_NAME}`, requireBuiltinTool(FINAL_RESPONSE_TOOL_NAME)),
  wrapExecutorTool(`meowbert_${WAIT_TOOL_NAME}`, buildWaitFunctionTool(false)),
  wrapExecutorTool(`meowbert_${STOP_TASK_TOOL_NAME}`, requireBuiltinTool(STOP_TASK_TOOL_NAME)),
  wrapExecutorTool(`meowbert_${LIST_SKILLS_TOOL_NAME}`, requireBuiltinTool(LIST_SKILLS_TOOL_NAME)),
  wrapExecutorTool(`meowbert_${ENABLE_SKILL_TOOL_NAME}`, requireBuiltinTool(ENABLE_SKILL_TOOL_NAME)),
  wrapExecutorTool(`meowbert_${MEMORY_SEARCH_TOOL_NAME}`, requireBuiltinTool(MEMORY_SEARCH_TOOL_NAME)),
  wrapExecutorTool("meowbert_search_web", SEARCH_WEB_TOOL)
];

const CORE_PROXY_BY_MCP_NAME = new Map(
  BRIDGE_CORE_PROXY_TOOLS.map((spec) => [spec.mcpName, spec.meowbertToolName!])
);

export function listBridgeMcpTools(mode: BridgeToolMode): StaticMcpToolSpec[] {
  return mode === "compact"
    ? BRIDGE_META_TOOLS
    : [...BRIDGE_META_TOOLS, ...BRIDGE_CORE_PROXY_TOOLS];
}

export function resolveCoreMeowbertToolName(mcpName: string): string | null {
  return CORE_PROXY_BY_MCP_NAME.get(mcpName) ?? null;
}
