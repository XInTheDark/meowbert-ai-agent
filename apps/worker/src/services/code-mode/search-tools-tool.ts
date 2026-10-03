import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

export const SEARCH_TOOLS_TOOL_NAME = "search_tools";

export const searchToolsArgumentsSchema = z.object({
  group: z.string().nullable(),
  query: z.string().nullable(),
  names: z.array(z.string()).nullable(),
  full_docs: z.boolean().nullable()
}).strict();

export type SearchToolsArguments = z.infer<typeof searchToolsArgumentsSchema>;

export const SEARCH_TOOLS_TOOL: FunctionTool = {
  type: "function",
  name: SEARCH_TOOLS_TOOL_NAME,
  description: "Look up the tools you can call from exec. With everything null, lists the groups. A group lists its tools, a query searches by keyword (within the group if you give one), and names picks exact tools.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      group: {
        type: ["string", "null"],
        description: "A group from exec's tool list, e.g. \"live_sync\" or a skill such as \"google_workspace\"."
      },
      query: {
        type: ["string", "null"],
        description: "Keywords for what you need, e.g. \"upload file\"."
      },
      names: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "Exact tool names, as exec calls them."
      },
      full_docs: {
        type: ["boolean", "null"],
        description: "true for each tool's full documentation with its arguments, false for a one-line summary. null gives full docs for names and summaries otherwise."
      }
    },
    required: ["group", "query", "names", "full_docs"],
    additionalProperties: false
  }
};
