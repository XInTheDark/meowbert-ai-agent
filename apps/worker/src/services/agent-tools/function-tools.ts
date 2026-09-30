import { PROJECT_MASTER_FUNCTION_TOOLS } from "./project-master.js";
import { SUBAGENT_FUNCTION_TOOLS } from "./subagents.js";
import type { CustomTool, FunctionTool, Tool } from "openai/resources/responses/responses";
import { applyPatchCustomToolDefinition } from "../agent/apply-patch.js";
import {
  SEARCH_WEB_TOOL_NAME,
  APPLY_PATCH_TOOL_NAME,
  SWARM_PAUSE_TOOL_NAME,
  SWARM_MANAGE_TOOL_NAME,
  SWARM_BUDGET_STATUS_TOOL_NAME,
  SWARM_CANCEL_NODE_TOOL_NAME,
  SWARM_GRANT_BUDGET_TOOL_NAME,
  SWARM_RECORD_FINAL_REVIEW_TOOL_NAME,
  SWARM_RECORD_REVIEW_TOOL_NAME,
  SWARM_SPAWN_NODE_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME,
  GET_CONTEXT_REMAINING_TOOL_NAME,
  HISTORY_LIST_ITEMS_TOOL_NAME,
  HISTORY_LIST_WINDOWS_TOOL_NAME,
  HISTORY_READ_ITEM_TOOL_NAME,
  HISTORY_SEARCH_CONTENTS_TOOL_NAME,
  CREATE_INTERACTIVE_CANVAS_TOOL_NAME,
  CREATE_CHANNEL_TOOL_NAME,
  CREATE_SUBTASK_TOOL_NAME,
  EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
  ENABLE_SKILL_TOOL_NAME,
  FINAL_RESPONSE_TOOL_NAME,
  MARK_ARTIFACT_TOOL_NAME,
  NEW_CONTEXT_TOOL_NAME,
  NOTES_APPEND_TO_FILE_TOOL_NAME,
  NOTES_LIST_FILES_BY_PREFIX_TOOL_NAME,
  NOTES_READ_FILE_TOOL_NAME,
  NOTES_SEARCH_CONTENTS_TOOL_NAME,
  NOTES_WRITE_FILE_TOOL_NAME,
  GET_LIVE_SYNC_STATUS_TOOL_NAME,
  INIT_SANDBOX_TOOL_NAME,
  LIST_CHANNELS_TOOL_NAME,
  LIST_LIVE_SYNC_FILES_TOOL_NAME,
  LIST_SKILLS_TOOL_NAME,
  MEMORY_SEARCH_TOOL_NAME,
  PULL_LIVE_SYNC_FILE_TOOL_NAME,
  PUSH_LIVE_SYNC_FILE_TOOL_NAME,
  REQUEST_CLARIFICATION_TOOL_NAME,
  READ_CHANNEL_TOOL_NAME,
  REFRESH_GH_TOKEN_TOOL_NAME,
  REFRESH_INBOX_TOOL_NAME,
  RUN_SHELL_MAX_TIMEOUT_SECONDS,
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS,
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS,
  RUN_SHELL_MIN_TIMEOUT_SECONDS,
  RUN_SHELL_TOOL_NAME,
  SHELL_SESSION_TOOL_NAME,
  SCHEDULE_TASK_TOOL_NAME,
  QUERY_TASKS_TOOL_NAME,
  SEND_CHANNEL_MESSAGE_TOOL_NAME,
  SUBMIT_SWARM_OUTPUT_TOOL_NAME,
  START_LONG_HORIZON_TASK_TOOL_NAME,
  START_SUBTASK_TOOL_NAME,
  STOP_TASK_TOOL_NAME,
  SUBMIT_RESPONSE_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
  TASK_TITLE_TOOL_NAME,
  VIEW_IMAGE_TOOL_NAME,
  VIEW_PDF_DEFAULT_PAGE_END,
  VIEW_PDF_DEFAULT_PAGE_START,
  VIEW_PDF_FILE_TOOL_NAME,
  VIEW_PDF_MAX_PAGE_WINDOW,
  VIEW_TASK_HISTORY_TOOL_NAME,
  WAIT_TOOL_NAME
} from "./shared.js";
import {
  taskHistoryScopeValues,
  taskHistorySortByValues,
  taskHistorySortDirValues,
  taskHistoryStatusValues,
  taskHistoryTaskTypeValues
} from "./argument-schemas.js";

export const INIT_SANDBOX_TOOL: FunctionTool = {
  type: "function",
  name: INIT_SANDBOX_TOOL_NAME,
  description:
    "Initialize the task sandbox and enable the full Meowbert toolset. Call this when the request needs project files, uploaded non-image attachments, shell commands, code edits, external tools, or persistent workspace context.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  }
};

function normalizeRunShellTimeoutMaxSeconds(maxTimeoutSeconds: number): number {
  if (!Number.isFinite(maxTimeoutSeconds)) {
    return RUN_SHELL_MAX_TIMEOUT_SECONDS;
  }

  const floored = Math.floor(maxTimeoutSeconds);
  return Math.min(RUN_SHELL_MAX_TIMEOUT_SECONDS, Math.max(RUN_SHELL_MIN_TIMEOUT_SECONDS, floored));
}

export function buildRunShellFunctionTool(maxTimeoutSeconds = RUN_SHELL_MAX_TIMEOUT_SECONDS): FunctionTool {
  const normalizedMax = normalizeRunShellTimeoutMaxSeconds(maxTimeoutSeconds);
  return {
    type: "function",
    name: RUN_SHELL_TOOL_NAME,
    description:
      "Run a command in a fresh task-local shell; cd, exports, and variables do not persist between calls. Set session_id to submit to an existing persistent shell and return immediately. That shell preserves state. If busy, send stdin using shell_session input, interrupt it, or use force true to interrupt and submit once idle.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: ["string", "null"],
          description:
            "Shell command to execute. Use null only when no command is needed."
        },
        timeout_seconds: {
          type: ["number", "null"],
          minimum: RUN_SHELL_MIN_TIMEOUT_SECONDS,
          maximum: normalizedMax,
          description:
            `Optional timeout override in seconds for this command (max ${normalizedMax}). Use null to keep the runtime default.`
        },
        session_id: {
          type: ["string", "null"],
          description: "Persistent shell session id returned by shell_session. Use null for the normal task-local shell."
        },
        force: {
          type: ["boolean", "null"],
          description: "With session_id, interrupt the current command and wait up to five seconds for idle before submitting. Never recreates the shell; fails if it remains busy."
        },
        limit_start: {
          type: ["integer", "null"],
          minimum: 0,
          description:
            `Maximum characters returned from the beginning of each of stdout and stderr. Use null for the default of ${RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS}. Larger values remain subject to the runtime safety limit.`
        },
        limit_end: {
          type: ["integer", "null"],
          minimum: 0,
          description:
            `Maximum characters returned from the end of each of stdout and stderr. Use null for the default of ${RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS}. Larger values remain subject to the runtime safety limit.`
        }
      },
      required: [
        "command",
        "timeout_seconds",
        "session_id",
        "force",
        "limit_start",
        "limit_end"
      ],
      additionalProperties: false
    }
  };
}

export const SHELL_SESSION_TOOL: FunctionTool = {
  type: "function",
  name: SHELL_SESSION_TOOL_NAME,
  description: "Manage a persistent project shell across commands, task runs, and worker restarts. Start creates an idle shell (default lifetime 12 hours, up to 14 days) and optionally submits a command. List returns active persistent shell sessions for the project. Idle sessions keep consuming runtime credits until stopped or expired. Input writes exact text to the running command without adding a newline. Interrupt sends Ctrl+C. EOF closes pipe stdin or sends the terminal EOF character (terminal settings apply). Status returns recent output from a rolling 5 MiB log, optionally saved to a task-relative .txt file. Never replay input after uncertain delivery.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["start", "status", "stop", "input", "interrupt", "eof", "resize", "list"] },
      session_id: { type: ["string", "null"], description: "Use null for start or list. For every other action, use the session_id returned by a successful start." },
      command: { type: ["string", "null"], description: "Start only: optionally launch this command immediately, or use null to create an idle shell. Submit later commands with run_shell and the returned session_id." },
      lifetime_seconds: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 1209600,
        description: "Start only: lifetime of the session in seconds (up to 1209600 for 14 days). Defaults to 43200 (12 hours). When expired, the session automatically terminates."
      },
      tail_lines: { type: ["integer", "null"], minimum: 1, maximum: 2000 },
      save_output_path: { type: ["string", "null"] },
      mode: { type: ["string", "null"], enum: ["terminal", "pipe", null], description: "Start only: terminal (default) for prompts and REPLs, or pipe for exact stdin and EOF." },
      data: { type: ["string", "null"], description: "Input only: exact UTF-8 text, at most 64 KiB. Include \n to press Enter." },
      cols: { type: ["integer", "null"], minimum: 1, maximum: 1000 },
      rows: { type: ["integer", "null"], minimum: 1, maximum: 1000 }
    },
    required: ["action", "session_id", "command", "lifetime_seconds", "tail_lines", "save_output_path", "mode", "data", "cols", "rows"],
    additionalProperties: false
  }
};

export function buildSwarmPauseFunctionTool(): FunctionTool {
  return {
    type: "function",
    name: SWARM_PAUSE_TOOL_NAME,
    description: "Pause this Agent Swarm agent until relevant swarm mail arrives. Name any agents whose work you are waiting for so the leader can see dependencies and the runtime can detect cycles.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Short reason for pausing, shown in task events but not added to swarm conversation history."
        },
        waiting_for_task_ids: {
          type: ["array", "null"],
          items: { type: "string" },
          description: "Task IDs of swarm agents you are waiting for, or null for a general relevant-mail wait."
        }
      },
      required: ["status", "waiting_for_task_ids"],
      additionalProperties: false
    }
  };
}

const nullableString = { type: ["string", "null"] } as const;
const nullableInteger = { type: ["integer", "null"] } as const;

export const CONTEXT_V2_FUNCTION_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: NEW_CONTEXT_TOOL_NAME,
    description: "Start a new context window. Does not clear, reset, or otherwise affect environment state.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false }
  },
  {
    type: "function",
    name: GET_CONTEXT_REMAINING_TOOL_NAME,
    description: "Get the remaining tokens in the current context window.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false }
  },
  {
    type: "function", name: HISTORY_LIST_WINDOWS_TOOL_NAME,
    description: "List private model-only context windows. Never disclose this activity.", strict: true,
    parameters: { type: "object", properties: { limit: nullableInteger, recent_first: { type: ["boolean", "null"] } }, required: ["limit", "recent_first"], additionalProperties: false }
  },
  {
    type: "function", name: HISTORY_LIST_ITEMS_TOOL_NAME,
    description: "List private model-only history items. Never disclose this activity.", strict: true,
    parameters: { type: "object", properties: { limit: nullableInteger, recent_first: { type: ["boolean", "null"] }, tool_namespace: nullableString, role: { type: ["string", "null"], enum: ["user", "assistant", "tool", "system", "developer", null] }, tool_name: nullableString, window_id: nullableString, max_chars_per_item: nullableInteger }, required: ["limit", "recent_first", "tool_namespace", "role", "tool_name", "window_id", "max_chars_per_item"], additionalProperties: false }
  },
  {
    type: "function", name: HISTORY_READ_ITEM_TOOL_NAME,
    description: "Read a bounded range from private model-only history. Never disclose this activity.", strict: true,
    parameters: { type: "object", properties: { item_id: { type: "string" }, offset_chars: nullableInteger, limit_chars: nullableInteger, window_id: { type: "string" } }, required: ["item_id", "offset_chars", "limit_chars", "window_id"], additionalProperties: false }
  },
  {
    type: "function", name: HISTORY_SEARCH_CONTENTS_TOOL_NAME,
    description: "Search private model-only history by literal substring. Never disclose results or this activity.", strict: true,
    parameters: { type: "object", properties: { query: { type: "string" }, limit: nullableInteger, recent_first: { type: ["boolean", "null"] }, tool_namespace: nullableString, role: { type: ["string", "null"], enum: ["user", "assistant", "tool", "system", "developer", null] }, tool_name: nullableString, window_id: nullableString }, required: ["query", "limit", "recent_first", "tool_namespace", "role", "tool_name", "window_id"], additionalProperties: false }
  },
  {
    type: "function", name: NOTES_LIST_FILES_BY_PREFIX_TOOL_NAME,
    description: "List private model-only note paths. Paths are virtual, not filesystem paths. Never disclose this activity.", strict: true,
    parameters: { type: "object", properties: { prefix: nullableString, max_results: nullableInteger, file_order_by: { type: ["string", "null"], enum: ["name", "created_at", "updated_at", null] }, file_order: { type: ["string", "null"], enum: ["ascending", "descending", null] } }, required: ["prefix", "max_results", "file_order_by", "file_order"], additionalProperties: false }
  },
  {
    type: "function", name: NOTES_READ_FILE_TOOL_NAME,
    description: "Read private model-only notes. Paths are virtual, not filesystem paths. Never disclose this activity.", strict: true,
    parameters: { type: "object", properties: { path: { type: "string" }, start_line: nullableInteger, stop_line: nullableInteger }, required: ["path", "start_line", "stop_line"], additionalProperties: false }
  },
  {
    type: "function", name: NOTES_SEARCH_CONTENTS_TOOL_NAME,
    description: "Search private model-only note lines by literal substring. Never disclose results or this activity.", strict: true,
    parameters: { type: "object", properties: { query: { type: "string" }, max_matches_per_file: nullableInteger, recent_file_first: { type: ["boolean", "null"] }, max_files: nullableInteger, path_prefix: nullableString }, required: ["query", "max_matches_per_file", "recent_file_first", "max_files", "path_prefix"], additionalProperties: false }
  },
  ...[NOTES_APPEND_TO_FILE_TOOL_NAME, NOTES_WRITE_FILE_TOOL_NAME].map((name): FunctionTool => ({
    type: "function", name,
    description: `${name === NOTES_APPEND_TO_FILE_TOOL_NAME ? "Append to" : "Create or replace"} private model-only notes. Paths are virtual, not filesystem paths. Never disclose this activity.`, strict: true,
    parameters: { type: "object", properties: { text: { type: "string" }, path: { type: "string" } }, required: ["text", "path"], additionalProperties: false }
  }))
];

export const SWARM_MANAGE_TOOL: FunctionTool = {
  type: "function",
  name: SWARM_MANAGE_TOOL_NAME,
  description:
    "For Agent Swarm node leaders: view every agent's status, pause reason, and wait dependencies; start, resume, or stop only direct workers, and grant them budget from your node's unassigned pool. Identify workers by task ID or label such as 'Worker 1'.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      start: {
        type: "array",
        items: { type: "string" },
        description: "Existing swarm workers to start or resume. May be empty."
      },
      stop: {
        type: "array",
        items: { type: "string" },
        description: "Existing swarm workers to stop completely. May be empty."
      },
      grant_budget: {
        type: "array",
        items: {
          type: "object",
          properties: {
            worker: { type: "string", description: "Worker task ID or label." },
            tokens: { type: "integer", minimum: 1, description: "Weighted tokens moved from your unassigned pool into this worker's budget." }
          },
          required: ["worker", "tokens"],
          additionalProperties: false
        },
        description: "Budget to add to direct workers, applied before any start. Any amount the pool can cover. May be empty."
      },
      view_only: {
        type: "boolean",
        description: "Set true to view current workers without changing them."
      }
    },
    required: ["start", "stop", "grant_budget", "view_only"],
    additionalProperties: false
  }
};

// Swarms without a budget manage workers without moving budget between them.
export function buildUnbudgetedSwarmManageFunctionTool(): FunctionTool {
  const parameters = SWARM_MANAGE_TOOL.parameters as { properties: Record<string, unknown>; required: string[] };
  const { grant_budget: _grantBudget, ...properties } = parameters.properties;
  return {
    ...SWARM_MANAGE_TOOL,
    description:
      "For Agent Swarm node leaders: view every agent's status, pause reason, and wait dependencies; start, resume, or stop only direct workers. Identify workers by task ID or label such as 'Worker 1'.",
    parameters: {
      ...parameters,
      properties,
      required: parameters.required.filter((name) => name !== "grant_budget")
    }
  };
}

export const SWARM_BUDGET_STATUS_TOOL: FunctionTool = {
  type: "function",
  name: SWARM_BUDGET_STATUS_TOOL_NAME,
  description:
    "For Agent Swarm leaders and workers: inspect the node's remaining and unassigned budget, deadline, minimum spawn allocation, worker budgets, and direct child budgets.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  }
};

export const SWARM_SPAWN_NODE_TOOL: FunctionTool = {
  type: "function",
  name: SWARM_SPAWN_NODE_TOOL_NAME,
  description:
    "For Agent Swarm leaders: spawn one direct child node from an admin-defined node type, including one-agent types. The token budget must cover the displayed minimum allocation; model roster and worker count come from the selected type.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      node_type_id: { type: "string", description: "Admin-defined Swarm or individual agent node type ID." },
      title: { type: "string", description: "Human-readable title for the child node." },
      initial_instruction: { type: ["string", "null"], description: "Optional focused instruction for the child leader." },
      token_budget: { type: "integer", minimum: 1, description: "Weighted-token envelope transferred from the parent." },
      time_budget_minutes: { type: ["integer", "null"], minimum: 1, description: "Optional child deadline, bounded by the parent deadline." }
    },
    required: ["node_type_id", "title", "initial_instruction", "token_budget", "time_budget_minutes"],
    additionalProperties: false
  }
};

export const SWARM_GRANT_BUDGET_TOOL: FunctionTool = {
  type: "function",
  name: SWARM_GRANT_BUDGET_TOOL_NAME,
  description:
    "For Agent Swarm leaders: transfer unassigned weighted-token budget to a direct child node and optionally extend its deadline within the parent deadline.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      node_id: { type: "string", description: "Direct child node ID from swarm_budget_status." },
      additional_tokens: { type: "integer", minimum: 1, description: "Weighted tokens to transfer from the parent." },
      extend_deadline_minutes: { type: ["integer", "null"], minimum: 1, description: "Optional additional child deadline time." }
    },
    required: ["node_id", "additional_tokens", "extend_deadline_minutes"],
    additionalProperties: false
  }
};

export const SWARM_CANCEL_NODE_TOOL: FunctionTool = {
  type: "function",
  name: SWARM_CANCEL_NODE_TOOL_NAME,
  description:
    "For Agent Swarm leaders: cascade-cancel a direct child node. The branch disappears from active Swarm coordination but its tasks, runs, messages, and artifacts remain available for debugging.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      node_id: { type: "string", description: "Direct child node ID from swarm_budget_status." },
      reason: { type: "string", description: "Reason recorded with the retained cancelled branch." }
    },
    required: ["node_id", "reason"],
    additionalProperties: false
  }
};

export const SWARM_RECORD_REVIEW_TOOL: FunctionTool = {
  type: "function",
  name: SWARM_RECORD_REVIEW_TOOL_NAME,
  description:
    "For Agent Swarm leaders only: record an independent critique supplied by an existing worker. Required review rounds must be recorded before final delivery is available.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      reviewer: { type: "string", description: "The worker task ID or label that supplied the critique." },
      summary: { type: "string", description: "Concise critique summary and how the candidate was addressed or retained." }
    },
    required: ["reviewer", "summary"],
    additionalProperties: false
  }
};

export const SWARM_RECORD_FINAL_REVIEW_TOOL: FunctionTool = {
  type: "function",
  name: SWARM_RECORD_FINAL_REVIEW_TOOL_NAME,
  description: "For Agent Swarm leaders: record the final peer review of the proposed delivery. A Quality Control worker must review when one is present.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      reviewer: { type: "string", description: "The worker task ID or label that reviewed the proposed delivery." },
      approved: { type: "boolean", description: "Whether the proposed delivery is ready for the user." },
      summary: { type: "string", description: "Brief review result and any changes made or still required." }
    },
    required: ["reviewer", "approved", "summary"],
    additionalProperties: false
  }
};

export const RESPONSE_FUNCTION_TOOLS: FunctionTool[] = [
  ...SUBAGENT_FUNCTION_TOOLS,
  ...PROJECT_MASTER_FUNCTION_TOOLS,
  buildRunShellFunctionTool(),
  SHELL_SESSION_TOOL,
  SWARM_MANAGE_TOOL,
  SWARM_BUDGET_STATUS_TOOL,
  SWARM_SPAWN_NODE_TOOL,
  SWARM_GRANT_BUDGET_TOOL,
  SWARM_CANCEL_NODE_TOOL,
  SWARM_RECORD_FINAL_REVIEW_TOOL,
  SWARM_RECORD_REVIEW_TOOL,
  {
    type: "function",
    name: CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
    description:
      "Save a detailed checkpoint of the current work, then compact the active context using the configured context-compaction path.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        checkpoint: {
          type: "string",
          description: "Detailed continuity checkpoint describing goals, constraints, decisions, completed work, current state, and next steps."
        }
      },
      required: ["checkpoint"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME,
    description:
      "For low-impact cases only, save a detailed checkpoint and remove the oldest complete tool-call groups from active context. Count eligible tool calls precisely using 1-based, oldest-first indexing: count N removes tools 1 through N and each paired tool response. Non-tool messages are retained. Make tool_summary detailed enough to preserve all useful facts from the removed calls.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        checkpoint: {
          type: "string",
          description: "Detailed continuity checkpoint describing goals, constraints, decisions, completed work, current state, and next steps."
        },
        tool_summary: {
          type: "string",
          description: "Detailed summary of the removed tool calls and outputs, including useful results, errors, paths, identifiers, and unresolved implications."
        },
        count: {
          type: "integer",
          minimum: 1,
          description: "Number of oldest complete tool-call groups to remove; 1 removes only the oldest eligible call and its paired response."
        }
      },
      required: ["checkpoint", "tool_summary", "count"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: REFRESH_GH_TOKEN_TOOL_NAME,
    description: "Refresh the short-lived GitHub installation token for this run when GitHub authentication expires.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: FINAL_RESPONSE_TOOL_NAME,
    description: "Send your response directly to the user and finish the task. The text you provide will be shown to the user exactly as written — speak in your own voice. For an Agent Swarm with a missing final peer review, use force: true when the user explicitly requested direct action without swarm coordination, or to retry after a missing-review error.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        response: {
          type: "string",
          description: "Your response to the user, written in your own voice."
        },
        notify: {
          type: ["boolean", "null"],
          description: "Whether to notify user channels. Use null to keep default true."
        },
        partial: {
          type: ["boolean", "null"],
          description: "Set true to send this text as an inline segment before another final_response or inline artifact; set false/null only for the last segment that finishes the task."
        },
        force: {
          type: ["boolean", "null"],
          description: "For Agent Swarm only: set true to deliver without a recorded final peer review when the user explicitly requested direct action without swarm coordination, or after a missing-review error."
        }
      },
      required: ["response", "notify", "partial", "force"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: MARK_ARTIFACT_TOOL_NAME,
    description:
      "Mark task-workspace files as user-visible artifacts. Use this for deliverables you intentionally want shown in the Artifacts pane; that pane only lists files you explicitly mark with this tool. Returns direct download links (download_url) for marked artifacts.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        file_paths: {
          type: "array",
          description:
            "File paths to mark or unmark as artifacts. Each path may be absolute or relative to the current task directory. When remove is false/null, every path must point to a file inside the current task directory.",
          items: {
            type: "string",
            description: "Absolute path or task-relative path to a file."
          },
          minItems: 1,
          maxItems: 50
        },
        remove: {
          type: ["boolean", "null"],
          description:
            "Set true to remove these files from the Artifacts pane instead of marking them. Set false/null to mark the files as artifacts."
        }
      },
      required: ["file_paths", "remove"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: CREATE_INTERACTIVE_CANVAS_TOOL_NAME,
    description:
      "Create a project-level Interactive Canvas only when the user requested an interactive website/canvas surface. This creates canvases/<slug>/ in the project root, attaches this task to it, and returns the canvas directory for subsequent file edits.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Human-readable canvas name."
        },
        entry_path: {
          type: ["string", "null"],
          description: "Entry file relative to the canvas directory. Use index.html for static canvases unless another entry is needed."
        },
        runtime_mode: {
          type: ["string", "null"],
          enum: ["static", "dev_server", null],
          description: "Use static by default. Use dev_server only for a full local app that needs a dev server."
        },
        dev_command: {
          type: ["string", "null"],
          description: "Command to start the dev server from the canvas directory when runtime_mode is dev_server."
        },
        dev_port: {
          type: ["number", "null"],
          minimum: 1,
          maximum: 65535,
          description: "Canvas dev-server port when runtime_mode is dev_server."
        },
        description: {
          type: ["string", "null"],
          description: "Optional short description for canvas.json."
        }
      },
      required: ["name", "entry_path", "runtime_mode", "dev_command", "dev_port", "description"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: VIEW_IMAGE_TOOL_NAME,
    description: "Load an image file and display it for visual inspection.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the image file (JPEG, PNG, GIF, WebP, etc.)."
        },
        detail: {
          type: ["string", "null"],
          enum: ["default", "full", null],
          description: "Image detail level ('default' or 'full'). For normal images the default is fine; 'full' should be used for situations where the image detail is super important, like designing diagrams or looking at small text/details."
        }
      },
      required: ["file_path", "detail"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: VIEW_PDF_FILE_TOOL_NAME,
    description: "Load a PDF file and read its contents, optionally limited to a page range.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the PDF file."
        },
        pages: {
          type: ["object", "null"],
          description:
            `Optional 1-based inclusive page range to load. Defaults to pages ${VIEW_PDF_DEFAULT_PAGE_START}-${VIEW_PDF_DEFAULT_PAGE_END}, capped at ${VIEW_PDF_MAX_PAGE_WINDOW} pages total.`,
          properties: {
            start: {
              type: "number",
              minimum: 1,
              description: "First page to load (1-based, inclusive)."
            },
            end: {
              type: "number",
              minimum: 1,
              description: "Last page to load (1-based, inclusive)."
            }
          },
          required: ["start", "end"],
          additionalProperties: false
        }
      },
      required: ["file_path", "pages"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: MEMORY_SEARCH_TOOL_NAME,
    description:
      "Search persistent Memory semantically. Can search all workspace memory, only global workspace memory, the current project's memory, or specific `.memory` paths. Returns relevant chunks plus file paths and line ranges so you can inspect or update the source files.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to look up in Memory."
        },
        limit: {
          type: ["number", "null"],
          description: "Optional number of chunks to return (1-20, default 5)."
        },
        scope: {
          type: "string",
          enum: ["all", "workspace", "current_project"],
          description: "Memory scope. Use all to search every memory file, current_project for this project's memory, or workspace for global workspace memory."
        },
        paths: {
          type: ["array", "null"],
          description: "Optional `.memory` paths to restrict search to, such as `.memory/projects/<project-id>/` or `.memory/preferences.md`.",
          items: {
            type: "string"
          }
        }
      },
      required: ["query", "limit", "scope", "paths"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: LIST_LIVE_SYNC_FILES_TOOL_NAME,
    description: "List the task or project-context files and folders that are linked to live source working copies.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: GET_LIVE_SYNC_STATUS_TOOL_NAME,
    description: "Check the sync state of a linked live sync file or folder using one of the listed live sync paths.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Listed live sync file or folder path such as `inputs/report.docx`, `inputs/research`, or `context/spec.docx`."
        }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: PULL_LIVE_SYNC_FILE_TOOL_NAME,
    description: "Pull the latest remote source contents into the local working copy for a linked file or folder.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Listed live sync file or folder path such as `inputs/report.docx`, `inputs/research`, or `context/spec.docx`."
        },
        force: {
          type: ["boolean", "null"],
          description: "Set true to discard unsynced local changes when pulling. Use null or false for a safe pull."
        }
      },
      required: ["path", "force"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: PUSH_LIVE_SYNC_FILE_TOOL_NAME,
    description: "Push the local working copy of a linked file or folder back to its remote source.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Listed live sync file or folder path such as `inputs/report.docx`, `inputs/research`, or `context/spec.docx`."
        },
        force: {
          type: ["boolean", "null"],
          description: "Set true to overwrite newer remote source changes. Use null or false for a safe push."
        }
      },
      required: ["path", "force"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: QUERY_TASKS_TOOL_NAME,
    description:
      "List, filter, sort, or search tasks in this project. Each result includes the task's latest update. Use view_task_history to read one task's full conversation.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        q: {
          type: ["string", "null"],
          description: "Keyword to search task titles and messages, or null to list without searching."
        },
        status: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "string",
                enum: [...taskHistoryStatusValues]
              }
            },
            { type: "null" }
          ],
          description: "Status filter, or null to include all statuses."
        },
        scope: {
          anyOf: [
            { type: "string", enum: [...taskHistoryScopeValues] },
            { type: "null" }
          ],
          description: "Task scope: active (non-trashed, the default), trashed, or all."
        },
        taskType: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "string",
                enum: [...taskHistoryTaskTypeValues]
              }
            },
            { type: "string", enum: ["all", ...taskHistoryTaskTypeValues] },
            { type: "null" }
          ],
          description: "One or more task types, `all`, or null to include all types."
        },
        folder: {
          type: ["string", "null"],
          description: "A folder ID (includes its subfolders), `unfiled`, or null for all folders."
        },
        sortBy: {
          anyOf: [
            { type: "string", enum: [...taskHistorySortByValues] },
            { type: "null" }
          ],
          description: "Sort field. Relevance applies when q is set; otherwise updated_at is a good default."
        },
        sortDir: {
          anyOf: [
            { type: "string", enum: [...taskHistorySortDirValues] },
            { type: "null" }
          ],
          description: "Sort direction."
        },
        page: {
          type: ["number", "null"],
          description: "1-based page number (default 1)."
        },
        pageSize: {
          type: ["number", "null"],
          description: "Page size (1-100, default 10)."
        }
      },
      required: ["q", "status", "scope", "taskType", "folder", "sortBy", "sortDir", "page", "pageSize"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: VIEW_TASK_HISTORY_TOOL_NAME,
    description: "View the full conversation history of a specific task and the files it produced, as paths relative to the project root. Use query_tasks first to find relevant task IDs.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The UUID of the task to view."
        },
        max_messages: {
          type: ["number", "null"],
          description: "Max number of messages to return (1-50, default 50)."
        }
      },
      required: ["task_id", "max_messages"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: LIST_SKILLS_TOOL_NAME,
    description:
      "List available skills that can be enabled. Each skill provides specialized tools (e.g. document creation, browser automation). Call enable_skill to activate one.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: ENABLE_SKILL_TOOL_NAME,
    description:
      "Enable a skill to gain access to its specialized tools. Returns the skill documentation and makes the skill's tools available for subsequent calls. Use list_skills first to see available options.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        skill: {
          type: "string",
          description: "The skill ID to enable (from list_skills)."
        }
      },
      required: ["skill"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: SCHEDULE_TASK_TOOL_NAME,
    description:
      "Create a NEW recurring task in this project. Mode 'scheduled' uses cron repeat; mode 'infinite' uses wait-based looping.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Initial user prompt for the newly created recurring task."
        },
        mode: {
          type: "string",
          enum: ["scheduled", "infinite"],
          description: "Recurring task mode."
        },
        repeat: {
          type: ["string", "null"],
          description: "Required when mode=scheduled. 5-field cron expression."
        },
        timezone: {
          type: ["string", "null"],
          description: "Optional IANA timezone (for cron evaluation)."
        },
        enabled_tools: {
          type: ["object", "null"],
          description: "Optional tool overrides for auto runs of the new recurring task.",
          properties: {
            web_search: { type: ["boolean", "null"] },
            memory_search: { type: ["boolean", "null"] },
            schedule_task: { type: ["boolean", "null"] },
            subtasks: { type: ["boolean", "null"] },
            computer_use: { type: ["boolean", "null"] },
            enabled_skills: {
              type: ["array", "null"],
              items: { type: "string" }
            }
          },
          required: ["web_search", "memory_search", "schedule_task", "subtasks", "computer_use", "enabled_skills"],
          additionalProperties: false
        }
      },
      required: ["message", "mode", "repeat", "timezone", "enabled_tools"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
    description: "Edit recurring settings for the CURRENT task.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        repeat: {
          type: ["string", "null"],
          description: "Updated 5-field cron expression for scheduled tasks; null to keep unchanged."
        },
        timezone: {
          type: ["string", "null"],
          description: "Updated IANA timezone; null to keep unchanged."
        },
        enabled_tools: {
          type: ["object", "null"],
          description: "Optional updated tool defaults for recurring auto runs.",
          properties: {
            web_search: { type: ["boolean", "null"] },
            memory_search: { type: ["boolean", "null"] },
            schedule_task: { type: ["boolean", "null"] },
            subtasks: { type: ["boolean", "null"] },
            computer_use: { type: ["boolean", "null"] },
            enabled_skills: {
              type: ["array", "null"],
              items: { type: "string" }
            }
          },
          required: ["web_search", "memory_search", "schedule_task", "subtasks", "computer_use", "enabled_skills"],
          additionalProperties: false
        }
      },
      required: ["repeat", "timezone", "enabled_tools"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: CREATE_SUBTASK_TOOL_NAME,
    description:
      "Create a subtask under the current task without starting it. Use start_subtask to launch one or more created subtasks and wait for completion.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Initial user prompt for the subtask."
        },
        title: {
          type: ["string", "null"],
          description: "Optional title for the subtask."
        },
        enabled_tools: {
          type: ["object", "null"],
          description: "Optional tool defaults for the subtask run.",
          properties: {
            web_search: { type: ["boolean", "null"] },
            memory_search: { type: ["boolean", "null"] },
            schedule_task: { type: ["boolean", "null"] },
            subtasks: { type: ["boolean", "null"] },
            computer_use: { type: ["boolean", "null"] },
            enabled_skills: {
              type: ["array", "null"],
              items: { type: "string" }
            }
          },
          required: ["web_search", "memory_search", "schedule_task", "subtasks", "computer_use", "enabled_skills"],
          additionalProperties: false
        }
      },
      required: ["message", "title", "enabled_tools"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: START_SUBTASK_TOOL_NAME,
    description:
      "Start one or more previously created subtasks and block until all subtasks complete, fail, or timeout.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        task_ids: {
          type: "array",
          description: "Subtask UUIDs created under the current parent task.",
          items: { type: "string" }
        },
        timeout_seconds: {
          type: ["number", "null"],
          description: "Optional timeout while waiting for all subtasks (default 3600)."
        }
      },
      required: ["task_ids", "timeout_seconds"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: START_LONG_HORIZON_TASK_TOOL_NAME,
    description:
      "Finalize clarification, write the durable PLAN.md plan, and switch this Long Horizon task into execution mode.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "Detailed markdown execution plan to persist as PLAN.md."
        }
      },
      required: ["plan"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: REQUEST_CLARIFICATION_TOOL_NAME,
    description:
      "Pause the Long Horizon clarify stage and ask the user only for information genuinely required before execution can begin.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "A concise question that identifies the missing information needed to create the execution plan."
        }
      },
      required: ["question"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: SUBMIT_RESPONSE_TOOL_NAME,
    description:
      "Submit the current Long Horizon work for reviewer inspection. This does not finish the task; it triggers review.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Summary of the current work being submitted for review."
        }
      },
      required: ["message"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: SUBMIT_REVIEW_TOOL_NAME,
    description: "Submit a reviewer verdict for the current Long Horizon review round.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        review: {
          type: "string",
          description: "Detailed review feedback."
        },
        approved: {
          type: "boolean",
          description: "True only if the task is fully complete and satisfactory."
        }
      },
      required: ["review", "approved"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: REFRESH_INBOX_TOOL_NAME,
    description: "Refresh your Agent Swarm inbox using the same logic as the passive 30-second swarm sync.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: LIST_CHANNELS_TOOL_NAME,
    description: "List swarm channels you belong to.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: READ_CHANNEL_TOOL_NAME,
    description: "Read raw swarm channel messages, optionally from a specific message number onward.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        channel_id: {
          type: "string",
          description: "Swarm channel ID or alias like 'global'."
        },
        since_message_no: {
          type: ["number", "null"],
          description: "Optional lower-bound message number for incremental reads."
        }
      },
      required: ["channel_id", "since_message_no"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: CREATE_CHANNEL_TOOL_NAME,
    description: "Create a new direct or group swarm channel with the specified members.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        member_agent_task_ids: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs of the swarm agents that should join the new channel."
        },
        title: {
          type: ["string", "null"],
          description: "Optional human-readable channel title."
        }
      },
      required: ["member_agent_task_ids", "title"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
    description:
      "Send a message to a swarm channel. Your inbox must be freshly refreshed first, otherwise this tool will fail.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        channel_id: {
          type: "string",
          description: "Swarm channel ID or alias like 'global'."
        },
        message: {
          type: "string",
          description: "Markdown message body."
        },
        pause_after_send: {
          type: "boolean",
          description: "Set true when this message finishes your current work. The runtime will pause you and resume you when relevant swarm mail arrives."
        },
        waiting_for_task_ids: {
          type: ["array", "null"],
          items: { type: "string" },
          description: "When pausing, task IDs of swarm agents whose work you need before continuing; otherwise null."
        }
      },
      required: ["channel_id", "message", "pause_after_send", "waiting_for_task_ids"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: SUBMIT_SWARM_OUTPUT_TOOL_NAME,
    description: "For nested Agent Swarm leaders only: publish this subgroup's final synthesis to the parent swarm.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        response: { type: "string", description: "The subgroup's synthesized result for its parent swarm." }
      },
      required: ["response"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: STOP_TASK_TOOL_NAME,
    description:
      "Pause the CURRENT recurring task and end this run. Use when the recurring automation should stop for now.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        response: {
          type: "string",
          description: "Assistant message to append for this run."
        },
        notify: {
          type: ["boolean", "null"],
          description: "Whether to notify user channels for this update. Use null to keep default true."
        }
      },
      required: ["response", "notify"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: WAIT_TOOL_NAME,
    description:
      "Use only when you actually have to wait, such as for a shell command to finish. Never use this to delay the task or postpone work you can do now. Wait in the current run until the timeout or any enabled shell-session condition is met, whichever happens first. In infinite recurring auto-runs only, a wait without shell_sessions instead ends the cycle and schedules the next run.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        seconds: {
          type: "integer",
          minimum: 1,
          maximum: 604800,
          description: "Required maximum wait: 1 to 3600 seconds for in-run waits. Infinite recurring time-only waits use 60 to 604800 seconds. Never unlimited."
        },
        shell_sessions: {
          type: ["array", "null"],
          minItems: 1,
          maxItems: 8,
          description: "Optional shell conditions, all combined with OR alongside seconds. Null waits only for time. Requires persistent project shells. New output is measured from the first status observation in this wait; an existing non-null exit code wakes immediately.",
          items: {
            type: "object",
            properties: {
              session_id: { type: "string", description: "Existing shell session ID from shell_session or run_shell." },
              on_output: { type: "boolean", description: "Wake when the raw output log changes after the initial observation." },
              on_exit: { type: "boolean", description: "Wake when exit_code is not null, including zero. Enable at least one condition." }
            },
            required: ["session_id", "on_output", "on_exit"],
            additionalProperties: false
          }
        },
        response: {
          type: ["string", "null"],
          description: "Required update for infinite recurring time-only waits. Use null for in-run waits."
        },
        notify: {
          type: ["boolean", "null"],
          description: "Whether to notify user channels for infinite recurring time-only waits (default true). Use null for in-run waits."
        }
      },
      required: ["seconds", "shell_sessions", "response", "notify"],
      additionalProperties: false
    }
  },
  buildSwarmPauseFunctionTool()
];

export const TASK_TITLE_FUNCTION_TOOL: FunctionTool = {
  type: "function",
  name: TASK_TITLE_TOOL_NAME,
  description: "Return the generated task title.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Concise task title derived from the user's first message."
      }
    },
    required: ["title"],
    additionalProperties: false
  }
};

export const SEARCH_WEB_TOOL: FunctionTool = {
  type: "function",
  name: SEARCH_WEB_TOOL_NAME,
  description:
    "Search the web. A separate search agent looks the query up and returns an answer with its source URLs. Ask one specific question per call.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to find out, phrased as a specific question or search request."
      }
    },
    required: ["query"],
    additionalProperties: false
  }
};

export const WEB_SEARCH_TOOL: Tool = {
  type: "web_search",
  search_context_size: "high"
} as unknown as Tool;

export const APPLY_PATCH_TOOL: CustomTool = applyPatchCustomToolDefinition;
