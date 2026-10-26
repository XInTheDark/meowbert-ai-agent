import type { FunctionTool, Tool } from "openai/resources/responses/responses";
import { COMPUTER_RESPONSE_FUNCTION_TOOLS } from "../computer/computer-tools.js";
import { ORGANIZATION_TOOL_NAMES } from "../agent-tools/conversation-organization.js";
import {
  APPLY_PATCH_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME,
  ENABLE_SKILL_TOOL_NAME,
  GET_CONTEXT_REMAINING_TOOL_NAME,
  FINAL_RESPONSE_TOOL_NAME,
  INIT_SANDBOX_TOOL_NAME,
  LIST_SKILLS_TOOL_NAME,
  NEW_CONTEXT_TOOL_NAME,
  NOTES_APPEND_TO_FILE_TOOL_NAME,
  NOTES_WRITE_FILE_TOOL_NAME,
  REQUEST_CLARIFICATION_TOOL_NAME,
  START_LONG_HORIZON_TASK_TOOL_NAME,
  STOP_TASK_TOOL_NAME,
  SUBMIT_RESPONSE_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
  WAIT_TOOL_NAME
} from "../agent-tools/index.js";
import { SWARM_TOOL_NAMES } from "../agent-tools/swarm.js";
import { buildExecTool } from "./exec-tool.js";
import { SEARCH_TOOLS_TOOL } from "./search-tools-tool.js";

// Tools the model keeps calling directly in code mode: ones that end or pause the turn, change the
// tool set or the context window, drive the computer, or edit files with a patch body that is awkward
// to embed in a JavaScript string. Note writes stay direct because they are the only tools offered
// while a context window is being checkpointed; history reads and context edits run inside exec, so a
// script can pull earlier outputs and replace them without writing them out.
const DIRECT_TOOL_NAMES = new Set<string>([
  FINAL_RESPONSE_TOOL_NAME,
  WAIT_TOOL_NAME,
  STOP_TASK_TOOL_NAME,
  START_LONG_HORIZON_TASK_TOOL_NAME,
  REQUEST_CLARIFICATION_TOOL_NAME,
  SUBMIT_RESPONSE_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
  ENABLE_SKILL_TOOL_NAME,
  LIST_SKILLS_TOOL_NAME,
  INIT_SANDBOX_TOOL_NAME,
  APPLY_PATCH_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME,
  NEW_CONTEXT_TOOL_NAME,
  GET_CONTEXT_REMAINING_TOOL_NAME,
  NOTES_APPEND_TO_FILE_TOOL_NAME,
  NOTES_WRITE_FILE_TOOL_NAME,
  ...COMPUTER_RESPONSE_FUNCTION_TOOLS.map((tool) => tool.name),
  ...ORGANIZATION_TOOL_NAMES,
  ...SWARM_TOOL_NAMES
]);

function isNestedTool(tool: Tool): tool is FunctionTool {
  return tool.type === "function" && !DIRECT_TOOL_NAMES.has(tool.name);
}

export interface CodeModeToolSet {
  responseTools: Tool[];
  // Tools reachable only through exec this turn; empty when code mode changed nothing.
  nestedTools: FunctionTool[];
}

export function buildCodeModeToolSet(tools: Tool[], maxTimeoutSeconds: number): CodeModeToolSet {
  const nestedTools = tools.filter(isNestedTool);
  if (nestedTools.length === 0) {
    return { responseTools: tools, nestedTools: [] };
  }

  return {
    responseTools: [
      ...tools.filter((tool) => !isNestedTool(tool)),
      buildExecTool(nestedTools, maxTimeoutSeconds),
      SEARCH_TOOLS_TOOL
    ],
    nestedTools
  };
}
