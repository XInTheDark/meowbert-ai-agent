import { z } from "zod";
import {
  TASK_HISTORY_SCOPE_VALUES as taskHistoryScopeValues,
  TASK_HISTORY_SORT_BY_VALUES as taskHistorySortByValues,
  TASK_HISTORY_SORT_DIR_VALUES as taskHistorySortDirValues,
  TASK_HISTORY_STATUS_VALUES as taskHistoryStatusValues,
  TASK_HISTORY_TASK_TYPE_VALUES as taskHistoryTaskTypeValues,
  taskHistoryScopeSchema,
  taskHistorySortBySchema,
  taskHistorySortDirSchema,
  taskHistoryStatusSchema,
  taskHistoryTaskTypeSchema
} from "@meowbert/shared/task-history-search";
import {
  RUN_SHELL_MAX_TIMEOUT_SECONDS,
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS,
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS,
  RUN_SHELL_MIN_TIMEOUT_SECONDS,
  VIEW_PDF_MAX_PAGE_WINDOW
} from "./shared.js";

function normalizeRunShellTimeoutMaxSeconds(maxTimeoutSeconds: number): number {
  if (!Number.isFinite(maxTimeoutSeconds)) {
    return RUN_SHELL_MAX_TIMEOUT_SECONDS;
  }

  const floored = Math.floor(maxTimeoutSeconds);
  return Math.min(RUN_SHELL_MAX_TIMEOUT_SECONDS, Math.max(RUN_SHELL_MIN_TIMEOUT_SECONDS, floored));
}

export function createRunShellArgumentsSchema(maxTimeoutSeconds = RUN_SHELL_MAX_TIMEOUT_SECONDS) {
  const normalizedMax = normalizeRunShellTimeoutMaxSeconds(maxTimeoutSeconds);
  return z.object({
    command: z.string().min(1).nullable().optional(),
    timeout_seconds: z
      .number()
      .int()
      .min(RUN_SHELL_MIN_TIMEOUT_SECONDS)
      .max(normalizedMax)
      .nullable()
      .optional(),
    session_id: z.string().uuid().nullable().optional(),
    force: z.boolean().nullable().optional(),
    // Kept parseable only so old saved tool calls receive a clear replacement error.
    background: z.boolean().nullable().optional(),
    background_id: z.string().min(1).nullable().optional(),
    wait_seconds: z.number().int().min(0).max(normalizedMax).nullable().optional(),
    limit_start: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .default(RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS),
    limit_end: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .default(RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS),
    stop: z.boolean().nullable().optional()
  }).strict();
}

export const runShellArgumentsSchema = createRunShellArgumentsSchema();
export const shellSessionArgumentsSchema = z.object({
  action: z.enum(["start", "status", "stop", "input", "interrupt", "eof", "resize", "list"]),
  session_id: z.string().uuid().nullable(),
  command: z.string().min(1).nullable(),
  lifetime_seconds: z.number().int().min(1).max(1_209_600).nullable().optional(),
  lifetime: z.number().int().min(1).max(1_209_600).nullable().optional(),
  tail_lines: z.number().int().min(1).max(2_000).nullable(),
  save_output_path: z.string().min(1).nullable(),
  mode: z.enum(["terminal", "pipe"]).nullable().optional(),
  data: z.string().refine((data) => Buffer.byteLength(data, "utf8") <= 65_536, "Input must not exceed 64 KiB.").nullable().optional(),
  cols: z.number().int().min(1).max(1000).nullable().optional(),
  rows: z.number().int().min(1).max(1000).nullable().optional()
}).strict().superRefine((value, context) => {
  if (value.action === "input" && value.data == null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "data is required for input." });
  }
  if (value.action === "resize" && (value.cols == null || value.rows == null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "cols and rows are required for resize." });
  }
  if (value.action !== "start" && value.action !== "list" && !value.session_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "session_id is required for an existing session." });
  }
});
export const refreshGhTokenArgumentsSchema = z.object({});

export const contextCheckpointAndCompactArgumentsSchema = z.object({
  checkpoint: z.string().min(1)
}).strict();

export const contextCheckpointAndTrimArgumentsSchema = z.object({
  checkpoint: z.string().min(1),
  tool_summary: z.string().min(1),
  count: z.number().int().positive()
}).strict();

export const contextEmptyArgumentsSchema = z.object({}).strict();
export const historyListWindowsArgumentsSchema = z.object({
  limit: z.number().int().min(1).max(100).nullable(),
  recent_first: z.boolean().nullable()
}).strict();
export const historyListItemsArgumentsSchema = z.object({
  limit: z.number().int().min(1).max(100).nullable(),
  recent_first: z.boolean().nullable(),
  tool_namespace: z.string().nullable(),
  role: z.enum(["user", "assistant", "tool", "system", "developer"]).nullable(),
  tool_name: z.string().nullable(),
  window_id: z.string().uuid().nullable(),
  max_chars_per_item: z.number().int().min(1).max(100_000).nullable()
}).strict();
export const historyReadItemArgumentsSchema = z.object({
  item_id: z.string().uuid(),
  offset_chars: z.number().int().min(0).nullable(),
  limit_chars: z.number().int().min(1).max(100_000).nullable(),
  window_id: z.string().uuid()
}).strict();
export const historySearchContentsArgumentsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).nullable(),
  recent_first: z.boolean().nullable(),
  tool_namespace: z.string().nullable(),
  role: z.enum(["user", "assistant", "tool", "system", "developer"]).nullable(),
  tool_name: z.string().nullable(),
  window_id: z.string().uuid().nullable()
}).strict();
export const notesListFilesArgumentsSchema = z.object({
  prefix: z.string().nullable(),
  max_results: z.number().int().min(1).max(100).nullable(),
  file_order_by: z.enum(["name", "created_at", "updated_at"]).nullable(),
  file_order: z.enum(["ascending", "descending"]).nullable()
}).strict();
export const notesReadFileArgumentsSchema = z.object({
  path: z.string().min(1),
  start_line: z.number().int().nullable(),
  stop_line: z.number().int().nullable()
}).strict();
export const notesSearchContentsArgumentsSchema = z.object({
  query: z.string().min(1),
  max_matches_per_file: z.number().int().min(1).max(100).nullable(),
  recent_file_first: z.boolean().nullable(),
  max_files: z.number().int().min(1).max(100).nullable(),
  path_prefix: z.string().nullable()
}).strict();
export const notesMutationArgumentsSchema = z.object({
  text: z.string(),
  path: z.string().min(1)
}).strict();

export const finalResponseArgumentsSchema = z.object({
  summary: z.string().nullable().optional(),
  outline_review: z.enum(["updated", "unchanged", "not_applicable"]).nullable().optional(),
  response: z.string().min(1),
  notify: z.boolean().nullable().optional(),
  partial: z.boolean().nullable().optional()
});

export const markArtifactArgumentsSchema = z.object({
  file_paths: z.array(z.string().min(1)).min(1).max(50),
  remove: z.boolean().nullable().optional()
});

export const createInteractiveCanvasArgumentsSchema = z.object({
  name: z.string().min(1).max(120),
  entry_path: z.string().min(1).max(240).nullable().optional(),
  runtime_mode: z.enum(["static", "dev_server"]).nullable().optional(),
  dev_command: z.string().min(1).max(500).nullable().optional(),
  dev_port: z.number().int().min(1).max(65535).nullable().optional(),
  description: z.string().max(1000).nullable().optional()
}).strict();

export const taskTitleArgumentsSchema = z.object({
  title: z.string().min(1).max(240)
});

export const requestClarificationArgumentsSchema = z.object({
  question: z.string().min(1).max(2_000)
}).strict();

export const viewImageArgumentsSchema = z.object({
  file_path: z.string().min(1),
  detail: z.enum(["default", "full"]).nullable().optional()
});

export const viewPdfArgumentsSchema = z.object({
  file_path: z.string().min(1),
  pages: z
    .object({
      start: z.number().int().min(1),
      end: z.number().int().min(1)
    })
    .strict()
    .refine((value) => value.end >= value.start, {
      message: "pages.end must be greater than or equal to pages.start"
    })
    .refine((value) => value.end - value.start + 1 <= VIEW_PDF_MAX_PAGE_WINDOW, {
      message: `pages may include at most ${VIEW_PDF_MAX_PAGE_WINDOW} pages`
    })
    .nullable()
    .optional()
});

export const searchWebArgumentsSchema = z.object({
  query: z.string().min(1)
});

export const memorySearchArgumentsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).nullable().optional(),
  scope: z.enum(["all", "workspace", "current_project"]).nullable().optional(),
  paths: z.array(z.string().min(1)).max(10).nullable().optional()
}).strict();

export const listLiveSyncFilesArgumentsSchema = z.object({});

export const liveSyncStatusArgumentsSchema = z.object({
  path: z.string().min(1)
});

export const liveSyncMutationArgumentsSchema = z.object({
  path: z.string().min(1),
  force: z.boolean().nullable().optional()
});

// query and limit are legacy aliases kept so replayed search_task_history calls still parse.
export const queryTasksArgumentsSchema = z.object({
  q: z.string().max(320).nullable().optional(),
  query: z.string().max(320).nullable().optional(),
  status: z.array(taskHistoryStatusSchema).max(taskHistoryStatusValues.length).nullable().optional(),
  scope: taskHistoryScopeSchema.nullable().optional(),
  taskType: z.union([
    z.array(taskHistoryTaskTypeSchema).max(taskHistoryTaskTypeValues.length),
    taskHistoryTaskTypeSchema,
    z.literal("all")
  ]).nullable().optional(),
  folder: z.string().max(64).nullable().optional(),
  sortBy: taskHistorySortBySchema.nullable().optional(),
  sortDir: taskHistorySortDirSchema.nullable().optional(),
  page: z.number().int().min(1).nullable().optional(),
  pageSize: z.number().int().min(1).max(100).nullable().optional(),
  limit: z.number().int().min(1).max(100).nullable().optional()
});

export const viewTaskHistoryArgumentsSchema = z.object({
  task_id: z.string().uuid(),
  max_messages: z.number().int().min(1).max(50).nullable().optional()
});

export const enableSkillArgumentsSchema = z.object({
  skill: z.string().min(1)
});

const enabledToolsSchema = z
  .object({
    web_search: z.boolean().nullable().optional(),
    memory_search: z.boolean().nullable().optional(),
    schedule_task: z.boolean().nullable().optional(),
    subtasks: z.boolean().nullable().optional(),
    computer_use: z.boolean().nullable().optional(),
    enabled_skills: z.array(z.string()).nullable().optional()
  })
  .strict()
  .nullable();

export const scheduleTaskArgumentsSchema = z.object({
  message: z.string().min(1),
  mode: z.enum(["scheduled", "infinite"]),
  repeat: z.string().min(1).nullable(),
  timezone: z.string().min(1).nullable(),
  enabled_tools: enabledToolsSchema
});

export const editCurrentTaskScheduleArgumentsSchema = z.object({
  repeat: z.string().min(1).nullable(),
  timezone: z.string().min(1).nullable(),
  enabled_tools: enabledToolsSchema
});

export const createSubtaskArgumentsSchema = z.object({
  message: z.string().min(1),
  title: z.string().min(1).max(240).nullable(),
  enabled_tools: enabledToolsSchema
});

export const startSubtaskArgumentsSchema = z.object({
  task_ids: z.array(z.string().uuid()).min(1).max(50),
  timeout_seconds: z.number().int().min(30).max(86400).nullable()
});

export const waitArgumentsSchema = z.object({
  seconds: z.number().int().min(1).max(604800),
  shell_sessions: z.array(z.object({
    session_id: z.string().uuid(),
    on_output: z.boolean(),
    on_exit: z.boolean()
  }).strict().refine((condition) => condition.on_output || condition.on_exit, {
    message: "Each shell session must enable on_output or on_exit."
  })).min(1).max(8).nullable().optional(),
  response: z.string().min(1).nullable().optional(),
  notify: z.boolean().nullable().optional()
}).strict();

export const swarmManageArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).nullable().optional(),
  start: z.array(z.string().min(1)).max(6),
  stop: z.array(z.string().min(1)).max(6),
  // Omitted from the tool schema when the swarm has no budget.
  grant_budget: z.array(z.object({
    worker: z.string().min(1),
    tokens: z.number().int().positive()
  }).strict()).max(6).optional(),
  view_only: z.boolean()
}).strict().superRefine((value, context) => {
  const overlap = value.start.find((worker) => value.stop.includes(worker));
  if (overlap) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Worker cannot be both started and stopped: ${overlap}` });
  }
  const changes = value.start.length + value.stop.length + (value.grant_budget?.length ?? 0);
  if (value.view_only && changes > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "view_only cannot be combined with start, stop, or grant_budget." });
  }
  if (!value.view_only && changes === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Provide a worker to start, stop, or grant budget to, or set view_only to true." });
  }
});

export const swarmBudgetStatusArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).nullable().optional()
}).strict();

export const swarmSpawnNodeArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).nullable().optional(),
  node_type_id: z.string().min(1).max(240),
  title: z.string().min(1).max(240),
  initial_instruction: z.string().min(1).max(20_000).nullable(),
  token_budget: z.number().int().positive(),
  time_budget_minutes: z.number().int().positive().nullable()
}).strict();

export const swarmGrantBudgetArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).nullable().optional(),
  node_id: z.string().uuid(),
  additional_tokens: z.number().int().positive(),
  extend_deadline_minutes: z.number().int().positive().nullable()
}).strict();

export const swarmCancelNodeArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).nullable().optional(),
  node_id: z.string().uuid(),
  reason: z.string().min(1).max(2_000)
}).strict();

export const swarmRecordReviewArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).optional(),
  reviewer: z.string().min(1),
  summary: z.string().min(1).max(20_000)
}).strict();

export const swarmRecordFinalReviewArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).optional(),
  reviewer: z.string().min(1),
  approved: z.boolean(),
  summary: z.string().min(1).max(20_000)
}).strict();

export const stopTaskArgumentsSchema = z.object({
  response: z.string().min(1),
  notify: z.boolean().nullable().optional()
});

export const startLongHorizonTaskArgumentsSchema = z.object({
  plan: z.string().min(1)
});

export const submitResponseArgumentsSchema = z.object({
  message: z.string().min(1)
});

export const submitReviewArgumentsSchema = z.object({
  review: z.string().min(1),
  approved: z.boolean()
});

export const refreshInboxArgumentsSchema = z.object({ target_swarm: z.enum(["outer", "inner"]).optional() });
export const listChannelsArgumentsSchema = z.object({ target_swarm: z.enum(["outer", "inner"]).optional() });

export const readChannelArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).optional(),
  channel_id: z.string().min(1),
  since_message_no: z.number().int().positive().nullable().optional()
});

export const createChannelArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).optional(),
  member_agent_task_ids: z.array(z.string().uuid()).min(2).max(8),
  title: z.string().min(1).max(120).nullable().optional()
});

export const sendChannelMessageArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).optional(),
  channel_id: z.string().min(1),
  message: z.string().min(1),
  pause_after_send: z.boolean(),
  waiting_for_task_ids: z.array(z.string().min(1)).max(32).nullable().optional()
});

export const swarmPauseArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).optional(),
  status: z.string().min(1).max(2_000),
  waiting_for_task_ids: z.array(z.string().min(1)).max(32).nullable().optional()
});

export const submitSwarmOutputArgumentsSchema = z.object({
  target_swarm: z.enum(["outer", "inner"]).optional(),
  response: z.string().min(1)
});

export {
  taskHistoryScopeValues,
  taskHistorySortByValues,
  taskHistorySortDirValues,
  taskHistoryStatusValues,
  taskHistoryTaskTypeValues
};
