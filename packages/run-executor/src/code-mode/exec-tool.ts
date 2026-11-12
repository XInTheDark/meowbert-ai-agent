import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import { MAX_PARALLEL_TOOL_CALLS } from "./script-runtime.js";
import { SEARCH_TOOLS_TOOL_NAME } from "./search-tools-tool.js";
import { groupColdTools, isLoadedOnDemand, type ToolCatalogGroup } from "./tool-catalog.js";

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
  `Independent calls can run in parallel with Promise.all; up to ${MAX_PARALLEL_TOOL_CALLS} run at once. Only what you console.log and return comes back to you, so trim large outputs in the script. Images and PDFs that tools load are shown to you after exec returns.`,
  "The code runs as the body of an async function. `process.env` holds the same variables run_shell sees, such as TASK_DIR and TASK_INPUT_DIR. There is no filesystem, network or other Node API besides `tools`, and nothing carries over between exec calls."
].join(" ");

function renderGroupLine(group: ToolCatalogGroup): string {
  return `- ${group.id}: ${group.tools.map((tool) => tool.name).join(", ")}`;
}

const LOOKUP_GUIDANCE = [
  "The tools you use most are documented in the system prompt.",
  `Look up any other tool with ${SEARCH_TOOLS_TOOL_NAME} before its first use: pass a group to see what its tools do, then names for their arguments.`,
  "Tools that enable_skill loads join `tools` under the names it lists."
].join(" ");

// Warm tools' signatures live in the system prompt (see code-mode-prompt.ts), not here.
function describeTools(nestedTools: FunctionTool[]): string {
  const listedGroups = groupColdTools(nestedTools.filter((tool) => !isLoadedOnDemand(tool)));
  return [
    EXEC_DESCRIPTION,
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
          description: "One short line the user sees when you move on to a different kind of work, e.g. \"Checking which tests fail\". The last line stays shown until you set a new one, so use null for follow-ups to the same work, such as a fix, a retry or a small edit."
        }
      },
      required: ["code", "timeout_seconds", "summary"],
      additionalProperties: false
    }
  };
}
