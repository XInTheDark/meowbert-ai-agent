import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import { SEARCH_TOOLS_TOOL_NAME } from "./search-tools-tool.js";
import { groupColdTools, isLoadedOnDemand, isWarmTool, type ToolCatalogGroup } from "./tool-catalog.js";
import { renderToolSignature } from "./tool-signatures.js";

export const EXEC_TOOL_NAME = "exec";

export const execArgumentsSchema = z.object({
  code: z.string().min(1),
  timeout_seconds: z.number().positive().nullable(),
  summary: z.string().nullable().optional()
}).strict();

export type ExecArguments = z.infer<typeof execArgumentsSchema>;

const EXEC_DESCRIPTION = [
  "Run JavaScript that calls your other tools, so several steps happen in one go: chain calls, loop over results, and keep only what you need.",
  "Each tool is an async function on `tools` that takes one arguments object and resolves to the tool's result. Omitted nullable arguments are sent as null, and a failed tool usually resolves to an object with an `error` field.",
  "Tool calls run one at a time. Only what you console.log and return comes back to you, so trim large outputs in the script.",
  "The code runs as the body of an async function. There is no filesystem, network or Node API besides `tools`, and nothing carries over between exec calls."
].join(" ");

function renderGroupLine(group: ToolCatalogGroup): string {
  return `- ${group.id}: ${group.tools.map((tool) => tool.name).join(", ")}`;
}

const LOOKUP_GUIDANCE = [
  `Look up any other tool with ${SEARCH_TOOLS_TOOL_NAME} before its first use: pass a group to see what its tools do, then names for their arguments.`,
  "Tools that enable_skill loads join `tools` under the names it lists."
].join(" ");

function describeTools(nestedTools: FunctionTool[]): string {
  const warmTools = nestedTools.filter(isWarmTool);
  const listedGroups = groupColdTools(nestedTools.filter((tool) => !isLoadedOnDemand(tool)));
  return [
    EXEC_DESCRIPTION,
    ...(warmTools.length > 0 ? [`Tools:\n\n${warmTools.map(renderToolSignature).join("\n\n")}`] : []),
    [LOOKUP_GUIDANCE, ...(listedGroups.length > 0 ? ["More tools, by group:", ...listedGroups.map(renderGroupLine)] : [])].join("\n")
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
        },
        summary: {
          type: ["string", "null"],
          description: "One short line the user sees about what this step does, e.g. \"Checking which tests fail\". Use null when the step is routine or no different from the last one."
        }
      },
      required: ["code", "timeout_seconds", "summary"],
      additionalProperties: false
    }
  };
}
