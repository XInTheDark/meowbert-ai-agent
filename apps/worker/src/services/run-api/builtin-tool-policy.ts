import type { Tool } from "openai/resources/responses/responses";
import { buildResponseTools, TASK_SCHEDULING_TOOL_GROUP_ID, TASK_TITLE_FUNCTION_TOOL } from "@meowbert/run-executor/agent-tools/index";
import { buildCodeModeToolSet } from "@meowbert/run-executor/code-mode/code-mode-tools";
import { resolveRunToolOptions } from "@meowbert/run-executor/agent/runtime";
import { COMPACTION_TOOL_NAME, COMPACTION_OUTPUT_SCHEMA } from "@meowbert/run-executor/context-compaction/shared";
import { workspaceFileFeatures, normalizeWorkspaceFileHost, getPersistentRuntimeEnabled } from "@meowbert/shared";
import { shouldExposeStopTaskForRecurringRun } from "@meowbert/run-executor/tasks/recurring-run-utils";
import type { ServerRunState } from "../run-host/bootstrap.js";

export interface DeviceToolConsent { hostShell?: boolean; hostBrowser?: boolean; computerUse?: boolean }

// Union of tools reachable during this run, including lazy tool groups and context recovery.
// The executor may send a subset each turn; parameter schemas still come from these definitions.
export function builtinRunTools(state: ServerRunState, consent: DeviceToolConsent): Tool[] {
  const { bootstrap, snapshot, job } = state;
  const local = job.executionTarget?.kind === "local";
  const host = local && job.executionTarget?.kind === "local" && job.executionTarget.mode === "host";
  const features = workspaceFileFeatures(normalizeWorkspaceFileHost(bootstrap.fileHost));
  const options = resolveRunToolOptions(snapshot, job, bootstrap.memoryEnabled);
  if (!features.memorySearch) options.memorySearch = false;
  const maximum = Math.max(1, Math.floor(snapshot.shell_tool_max_timeout_ms / 1000));
  const schedule = bootstrap.scheduleInfo ?? null;
  const allowStopTask = shouldExposeStopTaskForRecurringRun({ hasSchedule: schedule !== null, scheduleState: schedule?.scheduleState ?? null,
    isTimedInfiniteRun: job.mode === "infinite_auto" && schedule?.mode === "infinite" && (schedule.runTimeoutSeconds ?? 0) > 0 });
  const tools: Tool[] = [];
  for (const version of ["v1", "v2"] as const) for (const organization of [false, true]) {
    const ordinary = buildResponseTools(options, [], {
      allowFinalResponse: true, allowWaitTool: snapshot.task.allow_waiting !== false, allowStopTask,
      allowScheduleTools: snapshot.task.read_only !== true, loadedToolGroups: [TASK_SCHEDULING_TOOL_GROUP_ID],
      allowSubtaskTools: !local, allowPdfFileTool: !host && !bootstrap.runtime.compatibilityModes.includes("disablePdfFile"),
      newMessageOrganizationEnabled: organization, allowTaskHistoryTools: bootstrap.memoryEnabled,
      allowProjectMasterTools: !local && bootstrap.isProjectMaster,
      projectMasterTaskRouter: bootstrap.projectMasterTaskAgent?.router ?? null,
      allowLiveSyncTools: bootstrap.liveSyncFiles.length > 0,
      allowLiveSyncFileTools: features.linkedSources,
      allowLiveSyncFolderSearch: bootstrap.liveSyncFiles.some((file) => file.provider === "google-drive" && file.linkKind === "folder"),
      allowCanvasTools: features.canvases && !snapshot.task.read_only && options.enabledSkills.includes("html-canvas"),
      allowFileIndexTools: bootstrap.memoryEnabled, allowFileIndexSave: !snapshot.task.read_only,
      allowComputerLocalShell: !local, allowComputerVisualTools: !local || consent.computerUse === true,
      allowHostShell: local && consent.hostShell === true, allowRefreshGitHubToken: bootstrap.github.hasAppConnection,
      allowStartLongHorizonTask: !local, allowRequestClarification: !local, allowSubmitResponse: !local, allowSubmitReview: !local,
      runShellMaxTimeoutSeconds: maximum, contextManagementVersion: version,
      allowPersistentShellSessions: getPersistentRuntimeEnabled(bootstrap.runtime.environmentPayload), useClaudeWebSearch: bootstrap.runtime.modelType === "claude"
    });
    tools.push(...ordinary, ...buildResponseTools(options, [], { quickModeActive: true, newMessageOrganizationEnabled: organization }),
      ...buildCodeModeToolSet(ordinary, maximum).responseTools);
  }
  return tools;
}

export function auxiliaryTools(purpose: string): Tool[] {
  if (purpose === "title") return [TASK_TITLE_FUNCTION_TOOL];
  if (purpose === "compaction") return [{ type: "function", name: COMPACTION_TOOL_NAME, strict: true,
    parameters: COMPACTION_OUTPUT_SCHEMA, description: "" }];
  return [];
}
