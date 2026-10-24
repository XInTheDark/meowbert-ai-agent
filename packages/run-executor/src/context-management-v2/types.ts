import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { PlatformContextManagementVersion } from "@meowbert/shared";

export interface ContextManagementV2State {
  version: "v2";
  taskId: string;
  firstWindowId: string;
  windowId: string;
  contextNodeId: string;
  previousWindowId: string | null;
  branchLeafMessageId: string | null;
  reminderSent: boolean;
  pendingReset: boolean;
  recoveryPhase: "normal" | "needs_note" | "needs_reset";
}

export type ContextManagementState =
  | { version: "v1" }
  | ContextManagementV2State;

export interface ContextWindowRow {
  id: string;
  context_node_id: string;
  parent_window_id: string | null;
  branch_leaf_message_id: string | null;
  ordinal: number;
}

export interface ContextHistoryRow {
  id: string;
  ordinal: number;
  role: string;
  item_type: string | null;
  tool_namespace: string | null;
  tool_name: string | null;
  payload_json: ResponseInputItem;
  created_at: string;
}

export interface ContextNoteRow {
  path: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export type ContextManagementVersion = PlatformContextManagementVersion;
