import type { FunctionTool } from "openai/resources/responses/responses";

const reference = { type: "string", description: "An assistant turn message UUID, or current for this reply." };
const nullableString = { type: ["string", "null"] };
export const ORGANIZATION_TOOL_NAMES = ["update_conversation_outline", "update_conversation_map"];

export const ORGANIZATION_TOOLS: FunctionTool[] = [
  { type: "function", name: "update_conversation_outline", strict: true,
    description: "Create or replace the reader-facing conversation outline. Saved with your concluding response.",
    parameters: { type: "object", properties: { markdown: { type: "string" } }, required: ["markdown"], additionalProperties: false } },
  { type: "function", name: "update_conversation_map", strict: true,
    description: "Add or revise turn relationships and topic labels. Existing IDs are replaced, others retained. Saved as a complete snapshot with your concluding response.",
    parameters: { type: "object", properties: {
      nodes: { type: "array", items: { type: "object", properties: { id: reference, parent_id: { ...nullableString, description: "Earlier mapped turn ID, or null for the root." }, topic_id: nullableString }, required: ["id", "parent_id", "topic_id"], additionalProperties: false } },
      topics: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } }, required: ["id", "label"], additionalProperties: false } },
      main_path_end_id: { ...nullableString, description: "Endpoint of the main discussion, or null to keep the existing endpoint." }
    }, required: ["nodes", "topics", "main_path_end_id"], additionalProperties: false } }
];

export function withOrganizationFinalResponse(tool: FunctionTool): FunctionTool {
  const parameters = tool.parameters as { properties: Record<string, unknown>; required: string[] };
  return { ...tool, parameters: { ...tool.parameters,
    properties: { ...parameters.properties,
      summary: { type: ["string", "null"], description: "Plain-text one-line summary of the exchange, max 160 characters. Required for the concluding segment; null for partial segments." },
      outline_review: { type: ["string", "null"], enum: ["updated", "unchanged", "not_applicable", null], description: "Review the reader-facing outline before finishing. Null only for partial segments." }
    }, required: [...parameters.required, "summary", "outline_review"] } };
}

export function withOrganizationHistory(tool: FunctionTool): FunctionTool {
  const parameters = tool.parameters as { properties: Record<string, unknown>; required: string[] };
  return { ...tool, description: "Read public conversation messages with stable IDs, or the conversation outline and turn map. Null task_id means this task. Paginate with next_cursor; use message_ids for exact messages. Also lists the files the task produced, relative to the project root.",
    parameters: { ...tool.parameters, properties: { ...parameters.properties,
      task_id: { ...nullableString, description: "Task UUID, or null for this conversation." },
      view: { type: ["string", "null"], enum: ["messages", "navigation", null] },
      cursor: nullableString, branch_leaf_id: nullableString,
      message_ids: { type: ["array", "null"], items: { type: "string" } }
    }, required: [...parameters.required, "view", "cursor", "branch_leaf_id", "message_ids"] } };
}
