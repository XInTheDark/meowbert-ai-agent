import type { FunctionTool } from "openai/resources/responses/responses";
import { EXEC_TOOL_NAME } from "./exec-tool.js";
import { isWarmTool } from "./tool-catalog.js";
import { renderToolSignature } from "./tool-signatures.js";

export const CODE_MODE_TOOLS_PROMPT_REASON = "code-mode-tools";

// Warm tools are documented in the system prompt rather than in exec's description: providers that
// translate the request for another API may cut a long tool description short.
export function buildCodeModeToolsPrompt(nestedTools: FunctionTool[]): string {
  const warmTools = nestedTools.filter(isWarmTool);
  if (warmTools.length === 0) return "";
  return [
    `Inside ${EXEC_TOOL_NAME}, these tools are async functions on \`tools\`:`,
    ...warmTools.map(renderToolSignature)
  ].join("\n\n");
}
