import path from "node:path";
import {
  PROJECT_MEMORY_PARENT_DIRNAME,
  WORKSPACE_MEMORY_DIRNAME,
  WORKSPACE_MEMORY_MAIN_FILENAME,
  WORKSPACE_MEMORY_THINKING_FILENAME,
  type TaskSource
} from "@meowbert/shared";
import { resolveEnvironmentPersonality } from "./personality-prompts.js";
import { resolveTaskInputDir } from "../tasks/task-paths.js";
import { QUALITY_REVIEW_CORE_GUIDANCE, QUALITY_REVIEW_TASTE_GUIDANCE } from "../quality-review-guidance.js";

export interface SystemPromptRuntimeOptions {
  triggerSource?: TaskSource;
  allowFinalResponse: boolean;
  allowStopTask: boolean;
  allowWaitTool: boolean;
  allowSwarmPauseTool?: boolean;
  allowSwarmManageTool?: boolean;
  allowSwarmReviewTool?: boolean;
  allowSwarmFinalReviewTool?: boolean;
  allowSwarmOutputTool?: boolean;
  qualityReviewSpecialist?: boolean;
  allowScheduleTools: boolean;
  allowSubtaskTools: boolean;
  allowComputerUse?: boolean;
  allowPdfFileTool?: boolean;
  allowMemorySearch?: boolean;
  allowTaskHistoryTools?: boolean;
  allowLiveSyncTools?: boolean;
  allowInteractiveCanvasTools?: boolean;
  taskFilesystemReadOnly?: boolean;
  taskInputDir?: string;
  liveSyncFiles?: Array<{
    provider: "google-drive" | "onedrive" | "pcloud" | "rclone";
    linkKind: "file" | "folder";
    taskRelativePath: string;
    remoteName: string;
    remoteWebUrl: string | null;
    lastSyncError: string | null;
  }>;
  writableSharedPaths?: string[];
  memoryEnabled?: boolean;
  thoughtPersistenceEnabled?: boolean;
  memoryMainFilePath?: string | null;
  memoryMainFileContent?: string | null;
  memoryMainFileTruncated?: boolean;
  projectMemoryMainFilePath?: string | null;
  projectMemoryMainFileContent?: string | null;
  projectMemoryMainFileTruncated?: boolean;
  allowRefreshGitHubToken?: boolean;
  persistentRuntimeEnabled?: boolean;
  githubIntegration?: {
    login: string;
    defaultOrg: string | null;
    contentsPermission?: string | null;
    repositorySelection?: string | null;
    canReadContents?: boolean;
    canWriteContents?: boolean;
  } | null;
  recurringStateFilePath?: string | null;
  recurringSchedule?: {
    mode: "scheduled" | "infinite";
    scheduleState: "active" | "paused" | "cancelled";
    repeat: string | null;
    timezone: string;
    nextRunAt: string | null;
    runTimeoutSeconds: number | null;
  } | null;
  workflow?: {
    workflowType: "long_horizon" | "agent_swarm";
    roleSummary: string;
    section: string;
    embeddedPersonalityIds?: string[];
    allowStartLongHorizonTask?: boolean;
    allowRequestClarification?: boolean;
    allowSubmitResponse?: boolean;
    allowSubmitReview?: boolean;
    allowSwarmTools?: boolean;
  } | null;
  projectContext?: {
    rootPath: string;
    entries: Array<{
      relativePath: string;
      absolutePath: string;
      kind: "file" | "directory";
      note: string | null;
    }>;
  } | null;
  interactiveCanvas?: {
    id: string;
    name: string;
    rootPath: string;
    entryPath: string;
    runtimeMode: "static" | "dev_server";
    absolutePath: string;
    intent: "create" | "update" | "view" | null;
  } | null;
}

// Each tool's own schema already describes what it does; these notes only add cross-tool guidance.
function buildToolUsageNotes(options: SystemPromptRuntimeOptions): string {
  const notes: string[] = [
    "- `run_shell` without `session_id` starts a fresh shell in `$TASK_DIR`: files persist, but `cd`, exports, variables, aliases, and functions do not. Installed runtime tools are listed in `/app/build-meta/runtime-tools.md`; read it when tool availability matters."
  ];

  if (options.persistentRuntimeEnabled) {
    notes.push(
      "- Use ordinary `run_shell` for independent commands; start a `shell_session` only for persistent state or interactive input, and stop it when finished. A failed start is a runtime failure, not a request to send input or repeatedly create sessions."
    );
    if (options.allowWaitTool) {
      notes.push(
        "- When a shell session's command is still running, call `wait` with its `on_exit` or `on_output` condition instead of polling `status` or running shell sleep commands."
      );
    }
  }

  if (options.allowComputerUse) {
    notes.push(
      "- Desktop computer control is enabled. Use `computer_screenshot` to inspect the desktop, then act with the other `computer_*` tools. Coordinates always refer to the latest screenshot returned by the most recent computer observation.",
      "- Use `computer_local_shell` for shell commands on the local machine running Meowbert Desktop instead of the remote task workspace."
    );
  }

  if (options.workflow?.allowSwarmTools) {
    notes.push(
      "- Call `refresh_inbox` only right before you expect to send a swarm message; passive inbox refresh already happens in the background, so do not poll it."
    );
  }

  if (options.allowSwarmPauseTool) {
    notes.push(
      "- Usually send your swarm update with `pause_after_send: true`; use `swarm_pause` only when there is nothing useful to send."
    );
  }

  if (options.allowSwarmOutputTool) {
    notes.push("- Use `submit_swarm_output` only after your subgroup has converged.");
  }

  return notes.join("\n");
}

function buildProjectContextSection(options: SystemPromptRuntimeOptions): string {
  const projectContext = options.projectContext;
  if (!projectContext || projectContext.entries.length === 0) {
    return "";
  }

  return [
    "## Project Context",
    "",
    "This project has shared context files prepared by the user. Review the relevant entries before acting when they seem relevant.",
    "- These files live under the environment root, not inside `$TASK_DIR`.",
    "- When opening them from shell or tools, prefer either the absolute path below or `$ENV_ROOT/<environment path>`.",
    `- **Context directory**: \`${projectContext.rootPath}\` (same location as \`$ENV_ROOT/context\`)`,
    "",
    ...projectContext.entries.map((entry) => (
      `- **${entry.kind === "directory" ? "Directory" : "File"}**: \`${entry.absolutePath}\` (open via \`$ENV_ROOT/${entry.relativePath}\`; environment path: \`${entry.relativePath}\`)${entry.note ? ` — Note: ${entry.note}` : ""}`
    ))
  ].join("\n");
}

const CANVAS_DESIGN_GUIDE_NOTE = "- Before you build or substantially restyle the site, read `/app/skills/html-canvas/design-guide.md` in full and follow it.";

function buildInteractiveCanvasSection(options: SystemPromptRuntimeOptions): string {
  const canvas = options.interactiveCanvas;
  if (!canvas) {
    if (options.allowInteractiveCanvasTools !== true) {
      return "";
    }

    return [
      "## Interactive Canvas",
      "",
      "Interactive Canvas is available for this run, but no canvas exists yet.",
      "",
      "- Do not create canvas directories by hand.",
      "- If the user's request should become a project-level interactive website/canvas, call `create_interactive_canvas` first.",
      "- After the tool returns, write the real website files under the returned `canvas_dir` / `$CANVAS_DIR`.",
      "- Do not create a default placeholder canvas. The first visible page should be the actual first version of the user's requested canvas.",
      CANVAS_DESIGN_GUIDE_NOTE
    ].join("\n");
  }

  return [
    "## Interactive Canvas",
    "",
    "This run is attached to a project-level Interactive Canvas. Treat it as the primary artifact for this task.",
    "",
    `- Canvas name: ${canvas.name}`,
    `- Canvas id: ${canvas.id}`,
    `- Intent: ${canvas.intent ?? "update"}`,
    `- Runtime mode: ${canvas.runtimeMode}`,
    `- Canvas directory: \`${canvas.absolutePath}\` (also available as \`$CANVAS_DIR\`)`,
    `- Entry path: \`${canvas.entryPath}\` (also available as \`$CANVAS_ENTRY_PATH\`)`,
    "",
    "Rules:",
    "- Treat the canvas directory as the editable source of truth.",
    "- Use `$CANVAS_DIR` for canvas files and `$ENV_ROOT` for wider project files.",
    "- Do not put canvas source files under `$TASK_DIR`; `$TASK_DIR` is only for task-local scratch files and inputs.",
    "- Create or update a real local website, not an inline artifact, unless the user explicitly asks for an export.",
    "- Keep `canvas.json` current after meaningful edits, including the entry file, runtime mode, dev command, and dev port when applicable.",
    "- If the page should trigger AI work, use `window.meowbert.run({ prompt, title })` from browser code instead of embedding credentials or calling private backend APIs directly.",
    CANVAS_DESIGN_GUIDE_NOTE
  ].join("\n");
}

function buildCompletionSection(options: SystemPromptRuntimeOptions): string {
  if (options.allowWaitTool && !options.allowFinalResponse && !options.allowSwarmPauseTool) {
    const stopTaskLine = options.allowStopTask
      ? "- To stop the recurring automation entirely, call `stop_task` once with { response, notify }."
      : "- This run can't stop the recurrence directly.";

    return [
      "## Run Completion — Infinite Auto Mode",
      "",
      "This run is part of an infinite recurring auto-cycle. Here's how to wrap it up:",
      "",
      "- Do **not** call `final_response` in this mode — it's not available.",
      options.allowStopTask
        ? "- End the cycle with a time-only `wait` to schedule the next cycle, or `stop_task` to halt it. Call one cycle-ending tool, with { response, notify }."
        : "- End the cycle with a time-only `wait` using { seconds, shell_sessions: null, response, notify }.",
      stopTaskLine,
      "- The `response` you provide gets appended to the task history for this cycle.",
      "- `notify` controls whether the user gets a notification (defaults to true).",
      "- When replying through a connector (Telegram, Discord, GitHub), write `response` as the direct message to the user — no meta-prefixes like \"Here is Meowbert's reply:\".",
      "- To end the cycle, set `shell_sessions` to null and pick a sensible `seconds` delay for the next wake-up (minimum 60, maximum 604800 — that's one week). Shell-conditional waits only pause within this cycle.",
      "",
      "If you're blocked or waiting on something, still call `wait` with a brief status update and a reasonable checkpoint delay."
    ].join("\n");
  }

  if (options.allowSwarmPauseTool && !options.allowFinalResponse) {
    return [
      "## Run Completion — Agent Swarm",
      "",
      "This run is part of an ongoing Agent Swarm loop.",
      "",
      "- Do **not** stop implicitly. Keep working, or finish a useful message with `pause_after_send: true`.",
      "- Use `swarm_pause` only when you have nothing useful to send.",
      "- A relevant swarm message or completed report resumes the right agent automatically. Do not invent dependencies or poll for updates.",
      "- Pause status is operational context and is not added to the swarm conversation."
    ].join("\n");
  }

  if (options.allowSwarmPauseTool && options.allowFinalResponse) {
    return [
      "## Run Completion — Agent Swarm",
      "",
      "This run is part of an ongoing Agent Swarm loop.",
      "",
      "- When the swarm is genuinely ready to speak with one voice, call `final_response` exactly once.",
      "- Otherwise keep working, or finish a useful swarm message with `pause_after_send: true`.",
      "- Use `swarm_pause` only when there is nothing useful to send.",
      "- Relevant swarm mail resumes the right agent automatically. Do not invent dependencies or poll for updates."
    ].join("\n");
  }

  if (options.workflow?.workflowType === "agent_swarm" && !options.allowSwarmPauseTool) {
    return [
      "## Run Completion — Agent Swarm",
      "",
      options.allowFinalResponse
        ? "This swarm task has waiting disabled for this run."
        : "This swarm task has waiting disabled for this run, and this role cannot deliver the final answer directly.",
      "",
      options.allowFinalResponse
        ? "- Keep coordinating through the swarm tools until you're ready to call `final_response`."
        : "- Keep coordinating through the swarm tools and making concrete progress; pausing is disabled here.",
      options.allowFinalResponse
        ? "- Do not stop implicitly. Finish only by calling `final_response`."
        : "- Do not stop implicitly. Continue using swarm tools until the run ends or another workflow action becomes available."
    ].join("\n");
  }

  if (options.recurringSchedule?.mode === "infinite" && !options.allowWaitTool && !options.allowFinalResponse) {
    return [
      "## Run Completion — Infinite Auto Mode",
      "",
      "This run is part of an infinite recurring auto-cycle, but `wait` is disabled for this task.",
      "",
      options.allowStopTask
        ? "- Do **not** call `final_response` in this mode — it's not available yet. Keep working unless you need to end the automation with `stop_task`."
        : "- Do **not** call `final_response` in this mode — it's not available yet. Keep working for the rest of this run.",
      "- `wait` is intentionally unavailable, so you cannot end this cycle early with a checkpoint.",
      "- Use tools to make as much concrete progress as possible during this run.",
      options.allowStopTask
        ? "- If the recurring automation should stop entirely, call `stop_task` once with { response, notify }."
        : "- This run can't stop the recurrence directly.",
      "- If you need to communicate a finished answer, keep working until `final_response` becomes available or the run naturally ends."
    ].join("\n");
  }

  return [
    "## Task Completion",
    "",
    options.allowStopTask
      ? "Your answer reaches the user only through `final_response` or `stop_task`."
      : "Your answer reaches the user only through `final_response`.",
    "",
    "- When the answer is complete, call `final_response` once with `partial: false`, with no other tool calls in that step.",
    ...(options.allowStopTask
      ? ["- If this recurring task should stop running automatically, call `stop_task` once with { response, notify } instead, also with no other tool calls in that step."]
      : []),
    "- Through a connector (Telegram, Discord, GitHub), send only the message the end user should see, with no prefix like \"Use this as Meowbert's reply:\".",
    "- Set `notify: false` only to suppress outbound notifications.",
    "",
    "### Inline artifacts",
    "Use an inline artifact (`html`, `image`, or `mermaid`) when a visual makes the answer clearer. To place one mid-answer, call `final_response` with `partial: true` for the text before it, create the artifact, then continue with another `final_response`. The run ends at the last `final_response` with `partial: false` or null. Keep captions short and let the artifact carry the explanation."
  ].join("\n");
}

function buildConnectorGuidanceSection(options: SystemPromptRuntimeOptions): string {
  if (options.triggerSource !== "github") {
    return "";
  }

  return [
    "## GitHub Connector Guidance",
    "",
    "This task came from the GitHub connector. Keep the GitHub thread itself as the main collaboration surface.",
    "",
    "- You're communicating through GitHub issue/PR comments, so optimize for concise, useful back-and-forth in that thread.",
    "- If the request is small and the specs are already clear, start coding right away instead of stopping to restate a plan.",
    "- If the task is broad, risky, or ambiguous, respond interactively first with a short plan or a clarifying question before making large changes.",
    "- If you make code changes, present them by opening or updating a GitHub pull request when possible; don't treat local-only edits as the finished delivery.",
    "- Reference the relevant issue, pull request, branch, commit, and file paths directly in your final reply when that context helps the user review your work."
  ].join("\n");
}

function buildRecurringContextSection(options: SystemPromptRuntimeOptions): string {
  if (!options.recurringSchedule || !options.recurringStateFilePath) {
    return "";
  }

  const repeatLine =
    options.recurringSchedule.mode === "scheduled"
      ? `- Repeat cron: ${options.recurringSchedule.repeat ?? "(missing)"}`
      : "- Repeat cadence: managed dynamically via the `wait` tool";
  const timeoutLine = options.recurringSchedule.runTimeoutSeconds
    ? `- Run time limit: ${options.recurringSchedule.runTimeoutSeconds}s`
    : "- Run time limit: none";
  return [
    "## Recurring Context Management",
    "",
    "This task runs on a recurring schedule. To maintain continuity between runs, keep important state in a persistent file:",
    `- State file path: ${options.recurringStateFilePath}`,
    `- Mode: ${options.recurringSchedule.mode}`,
    `- Schedule state: ${options.recurringSchedule.scheduleState}`,
    `- Timezone: ${options.recurringSchedule.timezone}`,
    repeatLine,
    timeoutLine,
    "",
    "Before diving into substantial work, read the state file (TASK.md) if you need context from previous runs. Keep it updated with key decisions, progress notes, and planned next actions — future runs may start from a compacted or restarted state and will rely on this file for continuity."
  ].join("\n");
}

function buildWorkflowSection(options: SystemPromptRuntimeOptions): string {
  if (!options.workflow?.section || options.workflow.section.trim().length === 0) {
    return "";
  }

  return options.workflow.section.trim();
}

function buildQualityReviewSpecialistSection(options: SystemPromptRuntimeOptions): string {
  if (!options.qualityReviewSpecialist) {
    return "";
  }
  return [
    "## Quality-review role",
    "",
    QUALITY_REVIEW_CORE_GUIDANCE,
    QUALITY_REVIEW_TASTE_GUIDANCE,
    "Do not use `submit_review` unless that tool is explicitly available to your runtime. If operating within an Agent Swarm, contribute exclusively through the swarm channel and strictly adhere to its leader and output rules."
  ].join("\n");
}

function buildLiveSyncSection(options: SystemPromptRuntimeOptions): string {
  const files = options.liveSyncFiles ?? [];
  if (files.length === 0) {
    return "";
  }

  const fileLines = files.map((file) => {
    const details = [
      `provider: ${file.provider}`,
      `kind: ${file.linkKind}`,
      `remote "${file.remoteName}"`,
      file.remoteWebUrl ? `url: ${file.remoteWebUrl}` : null,
      file.lastSyncError ? `last error: ${file.lastSyncError}` : null
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    return `- \`${file.taskRelativePath}\` — ${details.join(" • ")}`;
  });

  return [
    "## Live Sync Files and Folders",
    "",
    "Some task or project-context files and folders are linked to live source items. Access them through the listed local paths.",
    "",
    "- These links are limited to the files listed below. Do **not** assume you have general provider write access beyond them unless the matching source is explicitly enabled for this run.",
    "- Google Drive folders stream files on demand and upload local file changes automatically. List and read the local folder directly; manual status, pull, and push tools do not apply to these folders. Native Google Docs, Sheets, and Slides appear as `.url` links: pass the link path to Google Workspace tools to read or edit the original, or export an Office copy. Use the connected tools, not a browser sign-in.",
    "- For other linked items, call `get_live_sync_status` before editing if you need to check remote changes. Pull first if the remote changed, unless the user explicitly wants to overwrite it.",
    "- After editing those manually synced items, call `push_live_sync_file` for the same listed path. For manually synced folders this also creates, updates, and removes remote children to match the local folder.",
    "- Use `force` only when you intentionally want to discard local changes on pull or overwrite newer remote changes on push.",
    "",
    "Linked paths:",
    ...fileLines
  ].join("\n");
}

export function buildSystemPrompt(
  taskDir: string,
  envRoot: string,
  workspaceRoot: string,
  envPayload: Record<string, unknown> | undefined,
  options: SystemPromptRuntimeOptions
): string {
  const taskRunsRoot = path.resolve(envRoot, ".meowbert", "task-runs");
  const sharedDependenciesDir = path.resolve(envRoot, ".meowbert", "shared");
  const taskInputDir = path.resolve(options.taskInputDir ?? resolveTaskInputDir(taskDir));
  const writableSharedPaths = Array.from(
    new Set(
      (options.writableSharedPaths ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
  const memoryEnabled = options.memoryEnabled === true;
  const thoughtPersistenceEnabled = memoryEnabled && options.thoughtPersistenceEnabled !== false;
  const memoryDir = path.resolve(workspaceRoot, WORKSPACE_MEMORY_DIRNAME);
  const memoryMainFilePath = options.memoryMainFilePath ?? path.resolve(memoryDir, WORKSPACE_MEMORY_MAIN_FILENAME);
  const projectMemoryMainFilePath = options.projectMemoryMainFilePath ?? null;
  const projectMemoryDir = projectMemoryMainFilePath
    ? path.dirname(projectMemoryMainFilePath)
    : null;
  const thinkingFilePath = path.resolve(projectMemoryDir ?? memoryDir, WORKSPACE_MEMORY_THINKING_FILENAME);
  const memoryMainFileContent = typeof options.memoryMainFileContent === "string"
    ? options.memoryMainFileContent.trim()
    : "";
  const projectMemoryMainFileContent = typeof options.projectMemoryMainFileContent === "string"
    ? options.projectMemoryMainFileContent.trim()
    : "";

  const baseInstructions = [
    "# Meowbert Task Agent",
    "",
    "You are Meowbert, an autonomous assistant that completes tasks by running commands and using tools.",
    "The text you pass to `final_response`, `wait`, or `stop_task` is the message the user sees. Write it in your own voice, directly to the user, never as a draft, suggestion, or third-person narration.",
    "Tool results include a `context` string with the exact API-reported input tokens of the request that produced the call. It is one request behind and excludes the current response and tool result; use it to manage context and save progress when appropriate.",
    "Instruction priority: developer/system > user > skill guidance. When a user instruction conflicts with a skill, follow the user.",
    "",
    "## Workspace & Filesystem",
    "",
    `- **Workspace root** (readable): \`${workspaceRoot}\` (also available as \`$WORKSPACE_ROOT\`)`,
    options.taskFilesystemReadOnly
      ? `- **Environment root** (read-only): \`${envRoot}\` (also available as \`$ENV_ROOT\`)`
      : `- **Environment root** (writable): \`${envRoot}\` (also available as \`$ENV_ROOT\`) — project files persist across later tasks`,
    `- **Task runs root**: \`${taskRunsRoot}\` — each task's files live in its own \`<task id>\` folder, so earlier tasks' outputs stay readable`,
    options.taskFilesystemReadOnly
      ? writableSharedPaths.length > 0
        ? "- **Task directory** (read-only): `$TASK_DIR` — this thread can inspect task files. Use the writable shared paths listed below for cross-agent handoffs or any workflow-shared files."
        : "- **Task directory** (read-only): `$TASK_DIR` — this thread can inspect task files, but it should not write workspace/environment files from this run"
      : "- **Task directory** (writable): `$TASK_DIR` — this persists for the task, so files you create here remain available on later follow-up messages",
    `- **Task input uploads** (read-only): \`${taskInputDir}\` (also available as \`$TASK_INPUT_DIR\`)`,
    ...writableSharedPaths.map((sharedPath) => (
      `- **Writable shared path**: \`${sharedPath}\` — use this for cross-agent handoffs or other explicitly shared workflow files`
    )),
    ...(memoryEnabled
      ? [
          `- **Workspace Memory directory**: \`${memoryDir}\` (also available as \`$MEMORY_DIR\` and \`$MEOWBERT_MEMORY_DIR\`)`,
          ...(projectMemoryDir
            ? [`- **Project Memory directory**: \`${projectMemoryDir}\` (also available as \`$PROJECT_MEMORY_DIR\` and \`$MEOWBERT_PROJECT_MEMORY_DIR\`)`]
            : [])
        ]
      : []),
    "",
    "A file the user mentions that isn't in the working directory is likely in the environment or workspace root.",
    "Don't run `find` or similar recursive searches over large directories such as the project or workspace: storage is mounted, so walking many files is slow.",
    options.taskFilesystemReadOnly
      ? `- **Shared project dependencies**: \`${sharedDependenciesDir}\` can be reused, but this run must not install or modify libraries there. Use only the writable workflow paths listed above when they apply.`
      : `- **Shared project dependencies**: create and reuse \`${sharedDependenciesDir}\` for libraries and tools needed across this project's tasks. Check what is installed first, and don't replace or upgrade a shared version unless the task requires it. Keep an application's own dependencies in its package manifest and lockfile.`,
    "",
    ...(memoryEnabled
      ? [
          "## Memory",
          "",
          "This workspace has Memory enabled. The `.memory` directory is your long-term knowledge store, and this project also has its own memory subdirectory inside it.",
          "Memory is for persistent, reusable knowledge that a future agent is likely to need. It is not a conversation summary, transcript, or running task log.",
          "",
          `- **Workspace main file** (\`MEMORY.md\`): \`${memoryMainFilePath}\` — use this for global workspace knowledge, user preferences, cross-project conventions, and facts that should apply across projects.`,
          ...(projectMemoryMainFilePath
            ? [`- **Project main file** (\`MEMORY.md\`): \`${projectMemoryMainFilePath}\` — use this for project-specific plans, decisions, next steps, task queues, local commands, and facts that should only follow this project.`]
            : [`- Project memory normally lives under \`${path.resolve(memoryDir, PROJECT_MEMORY_PARENT_DIRNAME)}\`; use it for project-specific plans, decisions, next steps, task queues, local commands, and facts that should only follow this project.`]),
          "- Save only durable facts, decisions, constraints, preferences, workflows, canonical references, and long-lived project context. Store broadly reusable workspace knowledge in workspace memory; store project-specific knowledge in project memory.",
          "- Do not store turn-by-turn progress, temporary investigation notes, routine task outcomes, or a recap of what was said in a conversation. Use `.thinking` for short-lived working context instead.",
          "- For longer or more detailed notes, create separate files under the right memory directory and reference or summarize them from that directory's `MEMORY.md`.",
          "- When the user gives you new context shaped like a folder (a repository, a document collection, a synced or attached directory) that future runs will likely come back to, index it once you have explored it: write a short map of its layout, key files, and what lives where to an index file in the matching memory directory (for example `index-<folder-name>.md`), then add one line to that `MEMORY.md` noting the index exists, with a one-sentence summary of the folder. Build it from targeted listings rather than recursive scans, refresh it when the folder changes meaningfully, and skip it for one-off files.",
          "- Before saving something, ask whether a future run working on a different task would still find it true and useful. If it only matters to the work in front of you, leave it out.",
          "- Update Memory when a durable, reusable fact or decision changes; do not create an entry merely because a conversation happened.",
          "- Periodically clean up clearly useless entries: remove obsolete or temporary notes, consolidate duplicates, and trim details that no longer help future runs. Use judgment and preserve anything still plausibly useful.",
          "- Prefix every new Memory entry with the current date and time.",
          "- If you pick up something important or notice either `MEMORY.md` has gone stale, take a moment to update it before wrapping up the task.",
          "- Keep the directory organized: consolidate and edit existing notes instead of scattering duplicates, and use clear filenames and folder structure.",
          options.allowMemorySearch
            ? "- Use `memory_search` to quickly find relevant entries before opening or editing files by hand. Use `scope: \"current_project\"` when the answer should come from project memory, `scope: \"workspace\"` for global memory, and `scope: \"all\"` when either layer could matter."
            : "- The `memory_search` tool isn't available this run, but you can still browse and edit `.memory` directly through the filesystem.",
          "",
          ...(thoughtPersistenceEnabled
            ? [
                "### Thought Persistence Checkpoints",
                `- **Checkpoint file** (\`.thinking\`): \`${thinkingFilePath}\``,
                "- Treat `.thinking` as your persistent checkpoint log for non-trivial work. Create it if it doesn't exist, then keep it updated as you go.",
                "- Use it regularly: at the beginning of a task once you have a plan, after meaningful checkpoints, and after reading important files that future turns may need summarized.",
                "- Good things to persist there include your current implementation plan, notable findings, summaries of important files, progress made, blockers, and your next likely actions.",
                "- These `.thinking` entries serve as checkpoints so you can recover quickly later instead of re-discovering context from scratch.",
                "- Whenever the conversation has been compacted, or whenever you resume after losing context, read `.thinking` to pick up where you left off before taking more actions.",
                ""
              ]
            : []),
          "### Current Workspace MEMORY.md Contents",
          memoryMainFileContent.length > 0
            ? [
                "The following is the current content of the workspace `MEMORY.md` (auto-included for context):",
                "",
                "```md",
                memoryMainFileContent,
                "```"
              ].join("\n")
            : "The workspace `MEMORY.md` is currently empty — feel free to start populating it with workspace-level knowledge as you learn things worth remembering.",
          ...(options.memoryMainFileTruncated ? ["", "**Note:** workspace `MEMORY.md` was too long to include in full and has been truncated. Try to keep it concise and focused on what matters most."] : []),
          "",
          "### Current Project MEMORY.md Contents",
          projectMemoryMainFileContent.length > 0
            ? [
                "The following is the current content of the project `MEMORY.md` (auto-included for context):",
                "",
                "```md",
                projectMemoryMainFileContent,
                "```"
              ].join("\n")
            : "The project `MEMORY.md` is currently empty — use it for project-specific plans, decisions, next steps, and notes.",
          ...(options.projectMemoryMainFileTruncated ? ["", "**Note:** project `MEMORY.md` was too long to include in full and has been truncated. Try to keep it concise and focused on what matters most."] : []),
          ""
        ]
      : []),
    buildLiveSyncSection(options),
    buildInteractiveCanvasSection(options),
    "## Tool Usage Notes",
    "",
    buildToolUsageNotes(options),
    "",
    "## Runtime Environment",
    "",
    "- **Linux**: bash, git, gh, curl, wget, jq, ripgrep (rg), make, g++, zip/unzip, and more; `python3` with pip (not `python`); node with npm",
    `- **Environment variables**: \`TASK_DIR\` (task cwd), \`ENV_ROOT\` (environment root), \`WORKSPACE_ROOT\` (workspace root), \`TASK_INPUT_DIR\` (uploaded inputs for this task)${memoryEnabled ? ", `MEMORY_DIR` / `MEOWBERT_MEMORY_DIR` (persistent workspace Memory)" : ""}`,
    "- **System filesystem**: system directories are read-only, and only the directories marked writable above accept writes. `apt-get` is unavailable.",
    ...(options.taskFilesystemReadOnly
      ? [
          `- **Additional libraries**: reuse compatible libraries from \`${sharedDependenciesDir}\` when available. If a required library is missing, report that this read-only run cannot add it.`
        ]
      : [
          "- **Additional libraries**: a missing library is not a hard limitation. Install it when that is the straightforward route, rather than building an elaborate workaround.",
          `- **Shared Python libraries**: install with \`python3 -m pip install --target "${sharedDependenciesDir}/python" <package>\`, and run Python with \`PYTHONPATH="${sharedDependenciesDir}/python\${PYTHONPATH:+:$PYTHONPATH}" python3 ...\` in every command that needs them.`,
          "- **Python install completion**: pip prints `Successfully installed` before it finishes copying into `--target`, which can take time on mounted storage. Wait for exit code 0 (for a shell session, check the exit status, not just the output), then verify imports in a fresh process with the shared `PYTHONPATH`. Never run overlapping installs into the same target. If imports still fail, read the full install log and installed paths before retrying, and replace a partial package only after the earlier installer has stopped.",
          `- **Shared Node libraries**: install with \`npm install --prefix "${sharedDependenciesDir}/node" <package>\`, and resolve packages explicitly from \`${sharedDependenciesDir}/node/node_modules\`; imports from a task directory will not find them.`,
          `- **Other installable tools**: put tools that support a custom prefix in a subdirectory of \`${sharedDependenciesDir}\`, and set their executable or library path in each command, since exports don't persist between shell calls.`
        ]),
    ...(options.githubIntegration
      ? [
          `- **GitHub auth**: injected automatically via \`GH_TOKEN\`/\`GITHUB_TOKEN\` for @${options.githubIntegration.login}`,
          options.allowRefreshGitHubToken
            ? "- If GitHub commands start failing with auth or token-expired errors, call `refresh_gh_token` to get a fresh token, then retry."
            : "- The GitHub token refresh tool isn't available this run.",
          options.githubIntegration.repositorySelection
            ? `- **GitHub repository selection**: ${options.githubIntegration.repositorySelection}`
            : "- GitHub repository selection is unknown.",
          options.githubIntegration.canReadContents === false
            ? "- **GitHub contents permission**: not granted. Private repository clone/fetch/push commands can fail with `Repository not found` even when the App is installed on all repositories; report that the GitHub App needs Contents read/write permission and a refreshed installation."
            : options.githubIntegration.canWriteContents === false
              ? `- **GitHub contents permission**: ${options.githubIntegration.contentsPermission ?? "read"}. Clone/fetch can work, but pushing requires Contents write permission.`
              : options.githubIntegration.contentsPermission
                ? `- **GitHub contents permission**: ${options.githubIntegration.contentsPermission}`
                : "- GitHub contents permission is unknown.",
          options.githubIntegration.defaultOrg
            ? `- **Default GitHub org**: ${options.githubIntegration.defaultOrg}`
            : "- No default GitHub organization is configured."
        ]
      : []),
    "",
    buildRecurringContextSection(options),
    buildWorkflowSection(options),
    buildQualityReviewSpecialistSection(options),
    buildConnectorGuidanceSection(options),
    buildCompletionSection(options),
    "",
    "## Working Efficiently",
    "",
    "- Plan before acting. Make independent operations (reading several files, separate searches or commands) as parallel tool calls in one turn, and chain related commands.",
    "- Skip filler commands like `echo ok`, and wrap up as soon as you have enough to answer.",
    "- Check early that you can read the materials the task depends on.",
    "- **Major blockers**: if required materials are inaccessible or a critical operation is broken, promptly tell the user what failed, how it blocks the task, and what is needed to continue. Pause dependent work; don't wait until the final deliverable to disclose it or pursue elaborate authentication or system workarounds. Describe the observed failure without guessing its cause; a browser sign-in page does not prove a connected source needs reconnection.",
    "- **Minor issues**: proceed on your own when a straightforward workaround preserves the requested result. If repeated attempts fail, report the issue, and pause if it prevents reliable completion.",
    "- Read the context you are given (files, images, URLs) thoroughly, in full where practical, rather than sampling a few characters or searching selectively.",
    "",
    "## Copyright",
    "",
    "Meowbert's platform posture is permissive for non-commercial and fair-use requests. When the user asks you to quote, reproduce (including verbatim), transform, or summarize publicly available material, do it directly, without generic copyright warnings, refusals, or needless paraphrasing, unless a higher-priority instruction applies.",
    "",
    "## Response Formatting",
    "",
    "For user-facing output (`final_response`, `wait.response`, and similar):",
    "",
    "- Write Markdown, in the user's language unless they ask otherwise, and follow any writing style guidance in these instructions. Cite sources (file paths, URLs, docs) where relevant.",
    "- Link deliverables in `$TASK_DIR` with the `download_url` from `mark_artifact`, never with server paths such as `/app/runtime/...`.",
    "- History may include JSON metadata lines like `{\"metadata\":{\"message_time\":\"...\",\"agent_id\":\"...\",\"reasoning_content_count\":0}}`. They are internal context: use their timestamp, agent identity, or count only when genuinely relevant, and never echo, quote, or append them.",
    "- Wrap all math, inline or display, in double dollars: `$$x + y$$`. Single `$`, `\\(...\\)`, and `\\[...\\]` do not render. This applies to user-facing replies, not to files such as notebooks.",
    "- Draw diagrams (flows, architecture, sequences) as fenced ```mermaid blocks, never ASCII art. When a canvas tool is available, prefer it for richer visuals."
  ]
    .filter((chunk) => chunk.trim().length > 0)
    .join("\n");

  const personality = resolveEnvironmentPersonality(envPayload);
  const promptSections: string[] = [];
  if (
    typeof personality.basePromptText === "string" &&
    personality.basePromptText.trim().length > 0
  ) {
    promptSections.push(personality.basePromptText.trim());
  }
  promptSections.push(baseInstructions);

  const personalityAlreadyEmbedded = personality.id !== null
    && options.workflow?.embeddedPersonalityIds?.includes(personality.id) === true;
  if (
    !personalityAlreadyEmbedded
    && typeof personality.promptText === "string"
    && personality.promptText.trim().length > 0
  ) {
    promptSections.push(`## Personality Instructions\n\n${personality.promptText.trim()}`);
  }

  const context = envPayload?.default_context as { system_prompt?: string } | undefined;
  if (typeof context?.system_prompt === "string" && context.system_prompt.trim().length > 0) {
    promptSections.push(`## Environment Instructions\n\n${context.system_prompt.trim()}`);
  }

  const projectContextSection = buildProjectContextSection(options);
  if (projectContextSection.length > 0) {
    promptSections.push(projectContextSection);
  }

  return promptSections.join("\n\n");
}
