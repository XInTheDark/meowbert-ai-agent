import type { FunctionTool, Tool } from "openai/resources/responses/responses";

type WindowTools = { response: Tool[]; codeMode: FunctionTool[] };

function toolKey(tool: Tool): string {
  return tool.type + ":" + ("name" in tool && typeof tool.name === "string" ? tool.name : "");
}

// Descriptions are left out: exec's lists the tools behind it, and a stale one is harmless.
function toolShape(tool: Tool): string {
  const { description: _description, ...shape } = tool as Tool & { description?: unknown };
  return JSON.stringify(shape);
}

// A context window keeps the tool definitions it started with, since any change to them rewrites the
// cached prompt. Turning a tool off, or on behind exec, can be told in a note instead; a new top-level
// tool, or one whose arguments changed, cannot be called without new definitions.
export function needsNewToolDefinitions(frozen: WindowTools, current: WindowTools): boolean {
  const frozenByKey = new Map(frozen.response.map((tool) => [toolKey(tool), tool]));
  return current.response.some((tool) => {
    const kept = frozenByKey.get(toolKey(tool));
    return !kept || toolShape(kept) !== toolShape(tool);
  });
}
