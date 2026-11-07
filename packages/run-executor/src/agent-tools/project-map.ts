import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import { PROJECT_MAP_CARD_STATES } from "@meowbert/shared";

export const VIEW_PROJECT_MAP_TOOL_NAME = "view_project_map";
export const UPDATE_PROJECT_MAP_TOOL_NAME = "update_project_map";
export const PROJECT_MAP_TOOL_NAMES = [VIEW_PROJECT_MAP_TOOL_NAME, UPDATE_PROJECT_MAP_TOOL_NAME] as const;

export const PROJECT_MAP_OPS = [
  "create_folder", "rename_folder", "delete_folder", "set_note",
  "create_card", "update_card", "delete_card", "move"
] as const;
export type ProjectMapOpName = (typeof PROJECT_MAP_OPS)[number];

export const viewProjectMapSchema = z.object({ folder_id: z.string().uuid().nullable() });

const idOrRef = z.string().trim().min(1);
export const projectMapOperationSchema = z.object({
  op: z.enum(PROJECT_MAP_OPS),
  ref: z.string().trim().min(1).max(40).nullable(),
  id: idOrRef.nullable(),
  parent_id: idOrRef.nullable(),
  ids: z.array(idOrRef).max(200).nullable(),
  name: z.string().nullable(),
  text: z.string().nullable(),
  state: z.enum(PROJECT_MAP_CARD_STATES).nullable()
});
export type ProjectMapOperation = z.infer<typeof projectMapOperationSchema>;
export const updateProjectMapSchema = z.object({ operations: z.array(projectMapOperationSchema).min(1).max(50) });

const nullableString = (description: string) => ({ type: ["string", "null"], description });

const VIEW_DESCRIPTION = "Read the project map. With folder_id null you get the project brief and the whole tree, with each folder's note shortened. With a folder ID you get that folder's full note and everything under it, with full notes.";

const UPDATE_DESCRIPTION = [
  "Change the project map. Operations run in order, all or nothing.",
  "- create_folder: name, parent_id (null for top level), text (the folder's note, may be empty).",
  "- rename_folder: id, name.",
  "- delete_folder: id. Its contents move up to its parent, so nothing is lost.",
  "- set_note: id (a folder, or null for the project brief), text. Replaces the whole note.",
  "- create_card: name (title), parent_id (folder or null), text (details, may be empty), state.",
  "- update_card: id, and any of name, text, state; null keeps the current value.",
  "- delete_card: id.",
  "- move: ids (folders, cards or tasks, mixed), parent_id (target folder, or null for top level; tasks there are unfiled).",
  "Set ref on a create to name the new item, then use that ref as an id or parent_id in later operations of the same call."
].join("\n");

const OPERATION_PROPERTIES = {
  op: { type: "string", enum: [...PROJECT_MAP_OPS] },
  ref: nullableString("Your label for an item this operation creates, such as \"billing\". Null if not needed."),
  id: nullableString("Folder or card ID (or a ref) the operation acts on."),
  parent_id: nullableString("Target folder ID or ref. Null means the top level of the map."),
  ids: { type: ["array", "null"], items: { type: "string" }, description: "IDs or refs to move." },
  name: nullableString("Folder name or card title."),
  text: nullableString("Markdown for a note, or a card's details."),
  state: { type: ["string", "null"], enum: [...PROJECT_MAP_CARD_STATES, null], description: "Card state: idea, next (ready to start) or done." }
} as const;

function strictTool(name: string, description: string, properties: Record<string, unknown>): FunctionTool {
  return { type: "function", name, description, strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } };
}

export const PROJECT_MAP_FUNCTION_TOOLS: FunctionTool[] = [
  strictTool(VIEW_PROJECT_MAP_TOOL_NAME, VIEW_DESCRIPTION, {
    folder_id: nullableString("Folder to open, or null for the whole map.")
  }),
  strictTool(UPDATE_PROJECT_MAP_TOOL_NAME, UPDATE_DESCRIPTION, {
    operations: {
      type: "array",
      items: { type: "object", properties: OPERATION_PROPERTIES, required: Object.keys(OPERATION_PROPERTIES), additionalProperties: false }
    }
  })
];
