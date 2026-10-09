import { describe, expect, it } from "vitest";
import type { FunctionTool } from "openai/resources/responses/responses";
import {
  APPLY_PATCH_TOOL_NAME,
  SWARM_PAUSE_TOOL_NAME,
  SWARM_MANAGE_TOOL_NAME,
  SWARM_RECORD_FINAL_REVIEW_TOOL_NAME,
  SWARM_RECORD_REVIEW_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
  CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME,
  CREATE_CHANNEL_TOOL_NAME,
  CREATE_INTERACTIVE_CANVAS_TOOL_NAME,
  EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
  FINAL_RESPONSE_TOOL_NAME,
  GET_CONTEXT_REMAINING_TOOL_NAME,
  HISTORY_LIST_ITEMS_TOOL_NAME,
  GET_LIVE_SYNC_STATUS_TOOL_NAME,
  INIT_SANDBOX_TOOL_NAME,
  LIST_CHANNELS_TOOL_NAME,
  LIST_LIVE_SYNC_FILES_TOOL_NAME,
  MARK_ARTIFACT_TOOL_NAME,
  MEMORY_SEARCH_TOOL_NAME,
  NEW_CONTEXT_TOOL_NAME,
  NOTES_APPEND_TO_FILE_TOOL_NAME,
  NOTES_READ_FILE_TOOL_NAME,
  NOTES_WRITE_FILE_TOOL_NAME,
  PULL_LIVE_SYNC_FILE_TOOL_NAME,
  ASSIGN_WORKER_TOOL_NAME,
  RESPONSE_FUNCTION_TOOLS,
  RUN_SHELL_TOOL_NAME,
  SCHEDULE_TASK_TOOL_NAME,
  SHELL_SESSION_TOOL_NAME,
  shellSessionArgumentsSchema,
  QUERY_TASKS_TOOL_NAME,
  PUSH_LIVE_SYNC_FILE_TOOL_NAME,
  REQUEST_CLARIFICATION_TOOL_NAME,
  START_LONG_HORIZON_TASK_TOOL_NAME,
  STOP_TASK_TOOL_NAME,
  SUBMIT_RESPONSE_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
  TASK_SCHEDULING_TOOL_GROUP_ID,
  TASK_TITLE_FUNCTION_TOOL,
  VIEW_TASK_HISTORY_TOOL_NAME,
  VIEW_PDF_FILE_TOOL_NAME,
  WAIT_TOOL_NAME,
  buildResponseTools
} from "./index.js";
import { COMPUTER_LOCAL_SHELL_TOOL_NAME, COMPUTER_SCREENSHOT_TOOL_NAME } from "../computer/computer-tools.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includesObjectType(typeValue: unknown): boolean {
  if (typeValue === "object") {
    return true;
  }

  if (Array.isArray(typeValue)) {
    return typeValue.includes("object");
  }

  return false;
}

function collectStrictSchemaIssues(schema: unknown, path: string, issues: string[]): void {
  if (!isRecord(schema)) {
    return;
  }

  const properties = schema.properties;
  if (isRecord(properties) && includesObjectType(schema.type)) {
    const propertyKeys = Object.keys(properties);
    const required = Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : null;

    if (!required) {
      issues.push(`${path}: missing required array`);
    } else {
      const requiredSet = new Set(required);
      for (const key of propertyKeys) {
        if (!requiredSet.has(key)) {
          issues.push(`${path}: required is missing `);
        }
      }
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && isRecord(value)) {
      for (const [propKey, propSchema] of Object.entries(value)) {
        collectStrictSchemaIssues(propSchema, `${path}.properties.${propKey}`, issues);
      }
      continue;
    }

    if (Array.isArray(value) && (key === "anyOf" || key === "oneOf" || key === "allOf")) {
      value.forEach((item, index) => {
        collectStrictSchemaIssues(item, `${path}.${key}[${index}]`, issues);
      });
    }
  }
}

function validateTool(tool: FunctionTool): string[] {
  const issues: string[] = [];
  if (tool.strict !== true) {
    return issues;
  }

  collectStrictSchemaIssues(tool.parameters as unknown, `tool:${tool.name}`, issues);
  return issues;
}

describe("strict function tool schemas", () => {
  it("include every parameter property in required arrays", () => {
    const tools: FunctionTool[] = [...RESPONSE_FUNCTION_TOOLS, TASK_TITLE_FUNCTION_TOOL];
    const issues = tools.flatMap((tool) => validateTool(tool));
    expect(issues).toEqual([]);
  });

  it("exposes nullable run_shell output limits with 10,000-character defaults", () => {
    const tool = RESPONSE_FUNCTION_TOOLS.find((candidate) => candidate.name === RUN_SHELL_TOOL_NAME);
    const parameters = tool?.parameters as {
      properties?: Record<string, { type?: unknown; minimum?: number; description?: string }>;
      required?: string[];
    };

    expect(parameters.properties?.limit_start).toEqual(expect.objectContaining({
      type: ["integer", "null"],
      minimum: 0
    }));
    expect(parameters.properties?.limit_start?.description).toContain("default of 10000");
    expect(parameters.properties?.limit_end).toEqual(expect.objectContaining({
      type: ["integer", "null"],
      minimum: 0
    }));
    expect(parameters.properties?.limit_end?.description).toContain("default of 10000");
    expect(parameters.required).toContain("limit_start");
    expect(parameters.required).toContain("limit_end");
  });
});

describe("buildResponseTools", () => {
  it("requires swarm targets only for dual-role leaders", () => {
    const options = {
      webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false,
      computerUse: false, enabledSkills: [], enabledSources: []
    };
    const availability = {
      allowSwarmTools: true, allowSwarmManageTool: true, allowSwarmPauseTool: true,
      allowSwarmReviewTool: true, allowSwarmFinalReviewTool: true, allowSwarmOutputTool: true
    };
    const targeted = buildResponseTools(options, [], { ...availability, requireSwarmTarget: true });
    const ordinary = buildResponseTools(options, [], availability);
    for (const tool of targeted) {
      if (tool.type !== "function" || ![
        SWARM_MANAGE_TOOL_NAME, SWARM_PAUSE_TOOL_NAME, ASSIGN_WORKER_TOOL_NAME,
        LIST_CHANNELS_TOOL_NAME, CREATE_CHANNEL_TOOL_NAME, SWARM_RECORD_REVIEW_TOOL_NAME,
        SWARM_RECORD_FINAL_REVIEW_TOOL_NAME, "read_channel", "send_channel_message",
        "submit_swarm_output"
      ].includes(tool.name)) continue;
      expect((tool.parameters as { required: string[] }).required).toContain("target_swarm");
      expect(validateTool(tool)).toEqual([]);
      const normal = ordinary.find((candidate) => candidate.type === "function" && candidate.name === tool.name);
      expect((normal?.parameters as { properties: Record<string, unknown> }).properties).not.toHaveProperty("target_swarm");
    }
  });

  it("drops budget and spawn tools for swarms without a budget", () => {
    const options = {
      webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false,
      computerUse: false, enabledSkills: [], enabledSources: []
    };
    const availability = { allowSwarmTools: true, allowSwarmManageTool: true };
    const names = (tools: ReturnType<typeof buildResponseTools>) => tools.flatMap((tool) => tool.type === "function" ? [tool.name] : []);
    const budgetToolNames = ["swarm_budget_status", "swarm_spawn_node", "swarm_grant_budget", "swarm_cancel_node"];

    const budgeted = buildResponseTools(options, [], { ...availability, allowSwarmBudgetTools: true });
    const unbudgeted = buildResponseTools(options, [], availability);

    expect(names(budgeted)).toEqual(expect.arrayContaining(budgetToolNames));
    for (const name of budgetToolNames) expect(names(unbudgeted)).not.toContain(name);
    const manage = unbudgeted.find((tool): tool is FunctionTool => tool.type === "function" && tool.name === SWARM_MANAGE_TOOL_NAME)!;
    expect((manage.parameters as { properties: Record<string, unknown> }).properties).not.toHaveProperty("grant_budget");
    expect(validateTool(manage)).toEqual([]);
  });

  it.each([false, true])("gates organization tools and strict summary fields in quickMode=%s", (quickModeActive) => {
    const options = { webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false, computerUse: false, enabledSkills: [], enabledSources: [] };
    const disabled = buildResponseTools(options, [], { quickModeActive, allowTaskHistoryTools: false });
    const enabled = buildResponseTools(options, [], { quickModeActive, allowTaskHistoryTools: false, newMessageOrganizationEnabled: true });
    const functions = enabled.filter((tool): tool is FunctionTool => tool.type === "function");
    expect(functions.map((tool) => tool.name)).toEqual(expect.arrayContaining(["update_conversation_outline", "update_conversation_map", "view_task_history", "final_response"]));
    expect(disabled.filter((tool) => tool.type === "function").map((tool) => tool.name)).not.toContain("update_conversation_map");
    expect(disabled.filter((tool) => tool.type === "function").map((tool) => tool.name)).not.toContain("view_task_history");
    expect(functions.flatMap(validateTool)).toEqual([]);
    expect(functions.find((tool) => tool.name === "final_response")?.parameters).toMatchObject({ required: expect.arrayContaining(["summary", "outline_review"]) });
    expect(functions.find((tool) => tool.name === "view_task_history")?.parameters).toMatchObject({ required: expect.arrayContaining(["message_ids", "branch_leaf_id", "cursor"]) });
  });

  it("only exposes persistent shell sessions when the project enables them", () => {
    const options = {
      webSearch: false,
      memorySearch: false,
      scheduleTask: false,
      subtasks: false,
      computerUse: false,
      enabledSkills: [],
      enabledSources: []
    };
    const disabled = buildResponseTools(options, []);
    const enabled = buildResponseTools(options, [], { allowPersistentShellSessions: true });

    expect(disabled.some((tool) => tool.type === "function" && tool.name === SHELL_SESSION_TOOL_NAME)).toBe(false);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === SHELL_SESSION_TOOL_NAME)).toBe(true);
  });

  it("validates shell_session arguments with action list and null session_id", () => {
    const validList = shellSessionArgumentsSchema.safeParse({
      action: "list",
      session_id: null,
      command: null,
      tail_lines: null,
      save_output_path: null,
      mode: null,
      data: null,
      cols: null,
      rows: null
    });
    expect(validList.success).toBe(true);

    const invalidStatus = shellSessionArgumentsSchema.safeParse({
      action: "status",
      session_id: null,
      command: null,
      tail_lines: null,
      save_output_path: null,
      mode: null,
      data: null,
      cols: null,
      rows: null
    });
    expect(invalidStatus.success).toBe(false);

    const validStartWithLifetime = shellSessionArgumentsSchema.safeParse({
      action: "start",
      session_id: null,
      command: "sleep 10",
      lifetime_seconds: 43200,
      tail_lines: null,
      save_output_path: null,
      mode: "terminal",
      data: null,
      cols: null,
      rows: null
    });
    expect(validStartWithLifetime.success).toBe(true);

    const validStartWithLifetimeAlias = shellSessionArgumentsSchema.safeParse({
      action: "start",
      session_id: null,
      command: null,
      lifetime: 86400,
      tail_lines: null,
      save_output_path: null,
      mode: null,
      data: null,
      cols: null,
      rows: null
    });
    expect(validStartWithLifetimeAlias.success).toBe(true);

    const invalidTooLongLifetime = shellSessionArgumentsSchema.safeParse({
      action: "start",
      session_id: null,
      command: null,
      lifetime_seconds: 14 * 86400 + 1,
      tail_lines: null,
      save_output_path: null,
      mode: null,
      data: null,
      cols: null,
      rows: null
    });
    expect(invalidTooLongLifetime.success).toBe(false);

    const invalidNonPositiveLifetime = shellSessionArgumentsSchema.safeParse({
      action: "start",
      session_id: null,
      command: null,
      lifetime_seconds: 0,
      tail_lines: null,
      save_output_path: null,
      mode: null,
      data: null,
      cols: null,
      rows: null
    });
    expect(invalidNonPositiveLifetime.success).toBe(false);
  });

  it("selects V1 or V2 context tools by the frozen context-management version", () => {
    const options = {
      webSearch: false,
      memorySearch: false,
      scheduleTask: false,
      subtasks: false,
      computerUse: false,
      enabledSkills: [],
      enabledSources: []
    };
    const disabled = buildResponseTools(options, []);
    const enabled = buildResponseTools(options, [], { contextManagementVersion: "v1" });
    const v2 = buildResponseTools(options, [], { contextManagementVersion: "v2" });
    const contextToolNames = [
      CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
      CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME
    ];

    expect(disabled.some((tool) => tool.type === "function" && contextToolNames.includes(tool.name))).toBe(false);
    expect(enabled.filter((tool) => tool.type === "function" && contextToolNames.includes(tool.name)))
      .toHaveLength(2);
    expect(v2.some((tool) => tool.type === "function" && tool.name === NEW_CONTEXT_TOOL_NAME)).toBe(true);
    expect(v2.some((tool) => tool.type === "function" && tool.name === GET_CONTEXT_REMAINING_TOOL_NAME)).toBe(true);
    expect(v2.some((tool) => tool.type === "function" && tool.name === HISTORY_LIST_ITEMS_TOOL_NAME)).toBe(true);
    expect(v2.some((tool) => tool.type === "function" && tool.name === NOTES_READ_FILE_TOOL_NAME)).toBe(true);
    expect(v2.some((tool) => tool.type === "function" && contextToolNames.includes(tool.name))).toBe(false);
  });

  it("emits provider-compatible names for V2 function tools", () => {
    const tools = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      { contextManagementVersion: "v2" }
    );
    const functionNames = tools
      .filter((tool) => tool.type === "function")
      .map((tool) => tool.name);

    expect(functionNames.every((name) => /^[a-zA-Z0-9_-]+$/.test(name))).toBe(true);
  });

  it("only exposes recovery tools while V2 is recovering", () => {
    const options = {
      webSearch: true,
      memorySearch: true,
      scheduleTask: true,
      subtasks: true,
      computerUse: true,
      enabledSkills: [],
      enabledSources: []
    };
    const skillTool = { type: "function" as const, name: "enabled_skill", description: "skill", strict: true, parameters: {} };

    const tools = buildResponseTools(options, [skillTool], {
      contextManagementVersion: "v2",
      contextRecoveryPhase: "needs_note"
    });

    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function", name: NOTES_APPEND_TO_FILE_TOOL_NAME }),
      expect.objectContaining({ type: "function", name: NOTES_WRITE_FILE_TOOL_NAME })
    ]));
    expect(tools).toHaveLength(2);
  });

  it("limits Quick mode turns to init_sandbox", () => {
    const tools = buildResponseTools(
      {
        webSearch: true,
        memorySearch: true,
        scheduleTask: true,
        subtasks: true,
        computerUse: true,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      { quickModeActive: true }
    );

    expect(tools).toHaveLength(1);
    expect(tools[0]?.type).toBe("function");
    expect(tools[0]?.type === "function" ? tools[0].name : null).toBe(INIT_SANDBOX_TOOL_NAME);
  });

  it("only includes Memory search when the task enables it", () => {
    const disabled = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      []
    );
    const enabled = buildResponseTools(
      {
        webSearch: false,
        memorySearch: true,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      []
    );

    expect(disabled.some((tool) => tool.type === "function" && tool.name === MEMORY_SEARCH_TOOL_NAME)).toBe(false);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === MEMORY_SEARCH_TOOL_NAME)).toBe(true);
  });

  it("gives task management tools only to the Project Master, including in Quick mode", () => {
    const options = {
      webSearch: false,
      memorySearch: false,
      scheduleTask: false,
      subtasks: false,
      computerUse: false,
      enabledSkills: [],
      enabledSources: []
    };
    const functionNames = (tools: ReturnType<typeof buildResponseTools>) =>
      tools.flatMap((tool) => tool.type === "function" ? [tool.name] : []);
    const masterToolNames = ["create_task", "message_task", "cancel_task", "listen_to_tasks"];

    const regular = functionNames(buildResponseTools(options, [], { allowTaskHistoryTools: false }));
    const master = functionNames(buildResponseTools(options, [], { allowTaskHistoryTools: false, allowProjectMasterTools: true }));
    const quickMaster = functionNames(buildResponseTools(options, [], { quickModeActive: true, allowProjectMasterTools: true }));

    expect(regular.filter((name) => masterToolNames.includes(name))).toEqual([]);
    expect(master).toEqual(expect.arrayContaining([...masterToolNames, QUERY_TASKS_TOOL_NAME, VIEW_TASK_HISTORY_TOOL_NAME]));
    expect(quickMaster).toEqual(expect.arrayContaining([...masterToolNames, QUERY_TASKS_TOOL_NAME, VIEW_TASK_HISTORY_TOOL_NAME]));
  });

  it("keeps the Project Master from doing work itself", () => {
    const options = {
      webSearch: true,
      memorySearch: false,
      scheduleTask: true,
      subtasks: true,
      computerUse: true,
      enabledSkills: [],
      enabledSources: []
    };
    const workerTools = buildResponseTools(options, [], { allowTaskHistoryTools: true });
    const tools = (availability: NonNullable<Parameters<typeof buildResponseTools>[2]>) => buildResponseTools(options, [], { allowProjectMasterTools: true, ...availability });
    const names = (list: ReturnType<typeof buildResponseTools>) => list.flatMap((tool) => tool.type === "function" ? [tool.name] : []);

    expect(names(workerTools)).toEqual(expect.arrayContaining([RUN_SHELL_TOOL_NAME]));
    for (const list of [tools({}), tools({ quickModeActive: true })]) {
      expect(names(list)).not.toContain(RUN_SHELL_TOOL_NAME);
      expect(names(list)).not.toContain(INIT_SANDBOX_TOOL_NAME);
      expect(names(list)).not.toContain(APPLY_PATCH_TOOL_NAME);
      expect(list.some((tool) => tool.type !== "function")).toBe(false);
    }
  });

  it("only includes task history tools when workspace Memory is enabled", () => {
    const options = {
      webSearch: false,
      memorySearch: false,
      scheduleTask: false,
      subtasks: false,
      computerUse: false,
      enabledSkills: [],
      enabledSources: []
    };
    const disabled = buildResponseTools(options, [], { allowTaskHistoryTools: false });
    const enabled = buildResponseTools(options, [], { allowTaskHistoryTools: true });
    const taskHistoryToolNames = [QUERY_TASKS_TOOL_NAME, VIEW_TASK_HISTORY_TOOL_NAME];

    expect(disabled.some((tool) => tool.type === "function" && taskHistoryToolNames.includes(tool.name))).toBe(false);
    expect(enabled.filter((tool) => tool.type === "function" && taskHistoryToolNames.includes(tool.name))).toHaveLength(2);
  });

  it("exposes create_interactive_canvas whenever project canvas tools are available", () => {
    const tools = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        interactiveCanvas: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      { allowInteractiveCanvasTools: true }
    );

    expect(tools.some((tool) => tool.type === "function" && tool.name === CREATE_INTERACTIVE_CANVAS_TOOL_NAME)).toBe(true);
  });

  it("only exposes live sync tools when availability enables them", () => {
    const disabled = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowLiveSyncTools: false
      }
    );
    const enabled = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowLiveSyncTools: true
      }
    );

    expect(disabled.some((tool) => tool.type === "function" && tool.name === LIST_LIVE_SYNC_FILES_TOOL_NAME)).toBe(false);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === GET_LIVE_SYNC_STATUS_TOOL_NAME)).toBe(false);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === PULL_LIVE_SYNC_FILE_TOOL_NAME)).toBe(false);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === PUSH_LIVE_SYNC_FILE_TOOL_NAME)).toBe(false);

    expect(enabled.some((tool) => tool.type === "function" && tool.name === LIST_LIVE_SYNC_FILES_TOOL_NAME)).toBe(true);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === GET_LIVE_SYNC_STATUS_TOOL_NAME)).toBe(true);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === PULL_LIVE_SYNC_FILE_TOOL_NAME)).toBe(true);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === PUSH_LIVE_SYNC_FILE_TOOL_NAME)).toBe(true);
  });

  it("keeps scheduling tools out of the request until their group is loaded", () => {
    const options = {
      webSearch: false,
      memorySearch: false,
      scheduleTask: true,
      subtasks: false,
      computerUse: false,
      enabledSkills: [],
      enabledSources: []
    };
    const names = (availability: NonNullable<Parameters<typeof buildResponseTools>[2]>) => buildResponseTools(options, [], availability)
      .flatMap((tool) => tool.type === "function" ? [tool.name] : []);

    expect(names({ allowScheduleTools: true })).not.toContain(SCHEDULE_TASK_TOOL_NAME);
    expect(names({ allowScheduleTools: true, loadedToolGroups: [TASK_SCHEDULING_TOOL_GROUP_ID] })).toEqual(
      expect.arrayContaining([SCHEDULE_TASK_TOOL_NAME, EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME])
    );
    expect(names({ allowScheduleTools: false, loadedToolGroups: [TASK_SCHEDULING_TOOL_GROUP_ID] })).not.toContain(SCHEDULE_TASK_TOOL_NAME);
  });

  it("always includes the explicit artifact-marking tool", () => {
    const tools = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      []
    );

    expect(tools.some((tool) => tool.type === "function" && tool.name === MARK_ARTIFACT_TOOL_NAME)).toBe(true);
  });

  it("omits view_pdf_file when PDF file viewing is disabled", () => {
    const enabled = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      []
    );
    const disabled = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      { allowPdfFileTool: false }
    );

    expect(enabled.some((tool) => tool.type === "function" && tool.name === VIEW_PDF_FILE_TOOL_NAME)).toBe(true);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === VIEW_PDF_FILE_TOOL_NAME)).toBe(false);
  });

  it("defines mark_artifact with a strict remove parameter", () => {
    const markArtifactTool = RESPONSE_FUNCTION_TOOLS.find((tool) => tool.name === MARK_ARTIFACT_TOOL_NAME);

    expect(markArtifactTool?.parameters).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        remove: expect.objectContaining({ type: ["boolean", "null"] })
      }),
      required: expect.arrayContaining(["file_paths", "remove"]),
      additionalProperties: false
    }));
  });

  it("defines final_response with a strict partial parameter and no review bypass", () => {
    const finalResponseTool = RESPONSE_FUNCTION_TOOLS.find((tool) => tool.name === FINAL_RESPONSE_TOOL_NAME);
    const parameters = finalResponseTool?.parameters as { properties: Record<string, unknown>; required: string[] };

    expect(parameters).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        partial: expect.objectContaining({ type: ["boolean", "null"] })
      }),
      required: ["response", "notify", "partial"],
      additionalProperties: false
    }));
    expect(parameters.properties.force).toBeUndefined();
  });

  it("includes the local desktop shell tool when computer use is enabled", () => {
    const tools = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: true,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowComputerLocalShell: true
      }
    );

    expect(tools.some((tool) => tool.type === "function" && tool.name === COMPUTER_LOCAL_SHELL_TOOL_NAME)).toBe(true);
  });

  it("can expose the local desktop shell without visual computer tools", () => {
    const tools = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: true,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowComputerLocalShell: true,
        allowComputerVisualTools: false
      }
    );

    expect(tools.some((tool) => tool.type === "function" && tool.name === COMPUTER_LOCAL_SHELL_TOOL_NAME)).toBe(true);
    expect(tools.some((tool) => tool.type === "function" && tool.name === COMPUTER_SCREENSHOT_TOOL_NAME)).toBe(false);
  });

  it("omits final_response and stop_task when availability disables them", () => {
    const tools = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowFinalResponse: false,
        allowStopTask: false,
        allowWaitTool: true
      }
    );

    expect(tools.some((tool) => tool.type === "function" && tool.name === FINAL_RESPONSE_TOOL_NAME)).toBe(false);
    expect(tools.some((tool) => tool.type === "function" && tool.name === STOP_TASK_TOOL_NAME)).toBe(false);
    expect(tools.some((tool) => tool.type === "function" && tool.name === WAIT_TOOL_NAME)).toBe(true);
  });

  it("only exposes request_clarification during an eligible clarify run", () => {
    const options = {
      webSearch: false,
      memorySearch: false,
      scheduleTask: false,
      subtasks: false,
      computerUse: false,
      enabledSkills: [],
      enabledSources: []
    };

    const enabled = buildResponseTools(options, [], { allowRequestClarification: true });
    const disabled = buildResponseTools(options, [], { allowRequestClarification: false });

    expect(enabled.some((tool) => tool.type === "function" && tool.name === REQUEST_CLARIFICATION_TOOL_NAME)).toBe(true);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === REQUEST_CLARIFICATION_TOOL_NAME)).toBe(false);
  });

  it("only exposes workflow-specific tools when availability enables them", () => {
    const disabled = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowFinalResponse: false
      }
    );
    const enabled = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowFinalResponse: false,
        allowStartLongHorizonTask: true,
        allowSubmitResponse: true,
        allowSubmitReview: true,
        allowSwarmTools: true,
        allowSwarmManageTool: true,
        allowSwarmReviewTool: true,
        allowSwarmFinalReviewTool: true
      }
    );

    expect(disabled.some((tool) => tool.type === "function" && tool.name === START_LONG_HORIZON_TASK_TOOL_NAME)).toBe(false);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === SUBMIT_RESPONSE_TOOL_NAME)).toBe(false);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === SUBMIT_REVIEW_TOOL_NAME)).toBe(false);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === ASSIGN_WORKER_TOOL_NAME)).toBe(false);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === LIST_CHANNELS_TOOL_NAME)).toBe(false);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === CREATE_CHANNEL_TOOL_NAME)).toBe(false);

    expect(enabled.some((tool) => tool.type === "function" && tool.name === START_LONG_HORIZON_TASK_TOOL_NAME)).toBe(true);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === SUBMIT_RESPONSE_TOOL_NAME)).toBe(true);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === SUBMIT_REVIEW_TOOL_NAME)).toBe(true);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === ASSIGN_WORKER_TOOL_NAME)).toBe(true);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === "refresh_inbox")).toBe(false);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === LIST_CHANNELS_TOOL_NAME)).toBe(true);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === CREATE_CHANNEL_TOOL_NAME)).toBe(true);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === SWARM_MANAGE_TOOL_NAME)).toBe(false);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === SWARM_MANAGE_TOOL_NAME)).toBe(true);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === SWARM_RECORD_REVIEW_TOOL_NAME)).toBe(false);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === SWARM_RECORD_REVIEW_TOOL_NAME)).toBe(true);
    expect(disabled.some((tool) => tool.type === "function" && tool.name === SWARM_RECORD_FINAL_REVIEW_TOOL_NAME)).toBe(false);
    expect(enabled.some((tool) => tool.type === "function" && tool.name === SWARM_RECORD_FINAL_REVIEW_TOOL_NAME)).toBe(true);
  });

  it("exposes swarm_pause separately from generic wait", () => {
    const swarmTools = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowFinalResponse: false,
        allowWaitTool: false,
        allowSwarmPauseTool: true
      }
    );

    expect(swarmTools.some((tool) => tool.type === "function" && tool.name === SWARM_PAUSE_TOOL_NAME)).toBe(true);
    expect(swarmTools.some((tool) => tool.type === "function" && tool.name === WAIT_TOOL_NAME)).toBe(false);
  });

  it("keeps final_response available alongside swarm_pause", () => {
    const tools = buildResponseTools(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowFinalResponse: true,
        allowSwarmPauseTool: true
      }
    );

    const swarmPauseTool = tools.find(
      (tool) => tool.type === "function" && tool.name === SWARM_PAUSE_TOOL_NAME
    );

    expect(tools.some((tool) => tool.type === "function" && tool.name === FINAL_RESPONSE_TOOL_NAME)).toBe(true);
    expect(swarmPauseTool).toEqual(expect.objectContaining({
      type: "function",
      name: SWARM_PAUSE_TOOL_NAME
    }));
    if (!swarmPauseTool || swarmPauseTool.type !== "function") {
      throw new Error("Expected swarm_pause function tool to be present.");
    }
    if (!swarmPauseTool.parameters) {
      throw new Error("Expected swarm_pause function tool parameters to be present.");
    }

    expect(swarmPauseTool.parameters).toEqual(expect.objectContaining({
      required: ["status", "wait_for_task_ids"]
    }));
    expect(isRecord(swarmPauseTool.parameters.properties)).toBe(true);
    expect(swarmPauseTool.parameters.properties).not.toHaveProperty("dependencies");
  });
});
