import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import { SEARCH_TOOLS_TOOL_NAME } from "./search-tools-tool.js";
import { groupColdTools, isWarmTool, shortToolName, type ToolCatalogGroup } from "./tool-catalog.js";
import { renderToolSignature } from "./tool-signatures.js";

export const EXEC_TOOL_NAME = "exec";

export const execArgumentsSchema = z.object({
  code: z.string().min(1),
  timeout_seconds: z.number().positive().nullable()
}).strict();

export type ExecArguments = z.infer<typeof execArgumentsSchema>;

const EXEC_DESCRIPTION = [
  "Run JavaScript that calls your other tools, so several steps happen in one go: chain calls, loop over results, and keep only what you need.",
  "Each tool is an async function on `tools` that takes one arguments object and resolves to the tool's result. Omitted nullable arguments are sent as null, and a failed tool usually resolves to an object with an `error` field.",
  "Tool calls run one at a time. Only what you console.log and return comes back to you, so trim large outputs in the script.",
  "The code runs as the body of an async function. There is no filesystem, network or Node API besides `tools`, and nothing carries over between exec calls."
].join(" ");

const MAX_NAMES_PER_GROUP = 10;

function renderGroupLine(group: ToolCatalogGroup): string {
  const names = group.tools.slice(0, MAX_NAMES_PER_GROUP).map(shortToolName).join(", ");
  const more = group.tools.length > MAX_NAMES_PER_GROUP ? `, … (+${group.tools.length - MAX_NAMES_PER_GROUP} more)` : "";
  return `- ${group.id}: ${names}${more}`;
}

function describeColdGroups(groups: ToolCatalogGroup[]): string {
  const hasSkillGroups = groups.some((group) => group.tools.some((tool) => shortToolName(tool) !== tool.name));
  return [
    `More tools, by group. Before using one for the first time, look it up with ${SEARCH_TOOLS_TOOL_NAME}: pass a group to see what its tools do, then names for their arguments.`
      + (hasSkillGroups ? " A skill's tools are called as tools.<group>__<name>." : ""),
    ...groups.map(renderGroupLine)
  ].join("\n");
}

function describeTools(nestedTools: FunctionTool[]): string {
  const warmTools = nestedTools.filter(isWarmTool);
  const coldGroups = groupColdTools(nestedTools);
  return [
    EXEC_DESCRIPTION,
    ...(warmTools.length > 0 ? [`Tools:\n\n${warmTools.map(renderToolSignature).join("\n\n")}`] : []),
    ...(coldGroups.length > 0 ? [describeColdGroups(coldGroups)] : [])
  ].join("\n\n");
}

export function buildExecTool(nestedTools: FunctionTool[], maxTimeoutSeconds: number): FunctionTool {
  return {
    type: "function",
    name: EXEC_TOOL_NAME,
    description: describeTools(nestedTools),
    strict: true,
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript to run, e.g. `const out = await tools.run_shell({ command: \"ls\" }); console.log(out.stdout);`"
        },
        timeout_seconds: {
          type: ["number", "null"],
          minimum: 1,
          maximum: maxTimeoutSeconds,
          description: `Limit for the whole script in seconds (max ${maxTimeoutSeconds}). A tool call already running finishes first. Use null for the default.`
        }
      },
      required: ["code", "timeout_seconds"],
      additionalProperties: false
    }
  };
}
