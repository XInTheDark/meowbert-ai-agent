import type { FunctionTool, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { EXEC_TOOL_NAME } from "../code-mode/exec-tool.js";
import { SEARCH_TOOLS_TOOL_NAME } from "../code-mode/search-tools-tool.js";

type WindowTools = { response: Tool[]; codeMode: FunctionTool[] };

export const TOOL_CHANGES_PREFIX = "[Tool changes]\n";
const BACK_TO_DEFINITIONS = "Every tool in your tool definitions is available again.";

function functionNames(tools: WindowTools): Set<string> {
  return new Set([...tools.response, ...tools.codeMode]
    .filter((tool): tool is FunctionTool => tool.type === "function")
    .map((tool) => tool.name));
}

// What differs between the tool definitions the window was started with and the tools this run
// allows. Null when they match.
function describeToolChanges(frozen: WindowTools, available: WindowTools): string | null {
  const frozenNames = functionNames(frozen);
  const availableNames = functionNames(available);
  const added = available.codeMode.map((tool) => tool.name).filter((name) => !frozenNames.has(name));
  const removed = [...frozenNames].filter((name) => !availableNames.has(name));
  if (added.length === 0 && removed.length === 0) return null;
  return [
    ...(added.length > 0 ? [`Now available inside ${EXEC_TOOL_NAME}: ${added.join(", ")}. Look up any you have not used with ${SEARCH_TOOLS_TOOL_NAME}.`] : []),
    ...(removed.length > 0 ? [`No longer available, so calls to them fail: ${removed.join(", ")}.`] : [])
  ].join("\n");
}

function latestToolChanges(items: ResponseInputItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const note = items[index] as { role?: string; content?: unknown };
    if (note.role === "developer" && typeof note.content === "string" && note.content.startsWith(TOOL_CHANGES_PREFIX)) {
      // Queued notes are sent with an id line, which is not part of what they say.
      return note.content.slice(TOOL_CHANGES_PREFIX.length).replace(/\n\[id: [^\]]+\]$/, "");
    }
  }
  return null;
}

// The note to add to the conversation, or null when the model already knows which tools it has.
export function buildToolChangeNotice(frozen: WindowTools, available: WindowTools, conversation: ResponseInputItem[]): string | null {
  const previous = latestToolChanges(conversation);
  const changes = describeToolChanges(frozen, available) ?? (previous && previous !== BACK_TO_DEFINITIONS ? BACK_TO_DEFINITIONS : null);
  return changes && changes !== previous ? TOOL_CHANGES_PREFIX + changes : null;
}
