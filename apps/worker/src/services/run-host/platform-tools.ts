import {
  getPersistentRuntimeEnabled,
  getSandboxNetworkEnabled,
  listCanvasSlugCandidates,
  PROJECT_CANVASES_DIR,
  resolveTaskScratchDir
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import { queryTasks, viewTaskHistory } from "../agent-db/index.js";
import { readOrganizedTaskHistory } from "../agent-db/conversation-history.js";
import { loadListenedTaskIds } from "../project-master/listeners.js";
import { searchMemoryIndex } from "../memory/index.js";
import {
  applyInfiniteWait,
  createRecurringTaskFromTool,
  editCurrentTaskSchedule,
  pauseRecurringSchedule
} from "../task-schedules/service.js";
import { createSubtaskFromTool, startSubtasksFromTool } from "../tasks/subtasks.js";
import {
  fetchTaskLiveSyncStatus,
  pullTaskLiveSyncFile,
  pushTaskLiveSyncFile,
  searchTaskLiveSyncFolder
} from "../agent/live-sync-client.js";
import { markTaskArtifacts, unmarkTaskArtifacts } from "../agent/artifacts.js";
import { getDesktopComputerPresence, requestDesktopComputerAction } from "../computer/computer-use.js";
import {
  buildPersistentShellEnvironment,
  controlPersistentShellSession,
  getPersistentShellSessionStatus,
  listPersistentShellSessions,
  runPersistentShellCommand,
  startPersistentShellSession,
  stopPersistentShellSession
} from "../runtime/persistent-shell-sessions.js";
import { buildSourceRuntimeEnv } from "../agent/source-runtime.js";
import type { PersistentShellRequest, PlatformToolHost } from "@meowbert/run-executor/agent/ports/platform-tools";
import type { ServerRunState } from "./bootstrap.js";

function requireActor(run: ServerRunState, feature: string): string {
  const actorUserId = run.bootstrap.runActorUserId;
  if (!actorUserId) {
    throw new Error(`${feature} requires an authenticated user.`);
  }
  return actorUserId;
}

async function insertProjectCanvas(run: ServerRunState, input: { name: string; entryPath: string }) {
  const { snapshot, job } = run;
  for (const slug of listCanvasSlugCandidates(input.name)) {
    const existing = await query<{ id: string }>(
      "SELECT id FROM project_canvases WHERE environment_id = $1 AND slug = $2 LIMIT 1",
      [snapshot.task.environment_id, slug]
    );
    if ((existing.rowCount ?? 0) > 0) continue;
    return withTransaction(async (client) => {
      const result = await client.query<{ id: string; name: string; root_path: string; entry_path: string }>(
        `INSERT INTO project_canvases (
           workspace_id, environment_id, name, slug, root_path, entry_path, created_by, last_task_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, root_path, entry_path`,
        [
          snapshot.task.workspace_id,
          snapshot.task.environment_id,
          input.name,
          slug,
          `${PROJECT_CANVASES_DIR}/${slug}`,
          input.entryPath,
          run.bootstrap.runActorUserId,
          job.taskId
        ]
      );
      await client.query(
        `UPDATE tasks
            SET interactive_canvas_id = $2,
                interactive_canvas_intent = 'create',
                updated_at = now()
          WHERE id = $1`,
        [job.taskId, result.rows[0].id]
      );
      const row = result.rows[0];
      return { id: row.id, name: row.name, rootPath: row.root_path, entryPath: row.entry_path };
    });
  }
  throw new Error("Too many canvases with similar names");
}

function persistentShellContext(run: ServerRunState, envOverrides: Record<string, string>) {
  const { snapshot, job, bootstrap } = run;
  if (!getPersistentRuntimeEnabled(bootstrap.runtime.environmentPayload)) {
    throw new Error("Persistent project shell sessions are disabled for this project.");
  }
  const creatorUserId = requireActor(run, "Persistent project shell sessions");
  const { envRoot, workspaceRoot } = bootstrap.roots;
  return {
    taskId: job.taskId,
    workspaceId: snapshot.task.workspace_id,
    environmentId: snapshot.task.environment_id,
    creatorUserId,
    taskDir: run.taskDir,
    // The run's executor prepared this directory before its first tool call.
    taskScratchDir: resolveTaskScratchDir(config.runtime.taskScratch.root, snapshot.task.workspace_id, job.taskId),
    envRoot,
    workspaceRoot,
    workingDir: envRoot,
    networkEnabled: getSandboxNetworkEnabled(bootstrap.runtime.baseEnvironmentJsonPayload),
    runAsRoot: snapshot.environment.workspace_run_as_root === true,
    shell: config.runtime.shell,
    env: buildPersistentShellEnvironment({
      taskDir: run.taskDir,
      envRoot,
      workspaceRoot,
      workingDir: envRoot,
      envOverrides
    })
  };
}

// Returns the output the agent sees for each shell_session action.
async function runPersistentShellRequest(run: ServerRunState, request: PersistentShellRequest): Promise<Record<string, unknown>> {
  const environmentId = run.snapshot.task.environment_id;
  switch (request.action) {
    case "list": {
      const sessions = await listPersistentShellSessions({ environmentId });
      return {
        sessions: sessions.map((session) => ({
          session_id: session.id,
          status: session.status,
          command: session.command,
          cwd: session.workingDir,
          mode: session.mode,
          started_at: session.startedAt,
          updated_at: session.updatedAt,
          command_id: session.commandId,
          exit_code: session.exitCode,
          output_truncated: session.outputTruncated,
          lifetime_seconds: session.lifetimeSeconds,
          expires_at: session.expiresAt
        }))
      };
    }
    case "status": {
      const result = await getPersistentShellSessionStatus({
        sessionId: request.sessionId,
        environmentId,
        taskDir: run.taskDir,
        tailLines: request.tailLines,
        saveOutputPath: request.saveOutputPath
      });
      return {
        session_id: result.sessionId,
        status: result.status,
        command: result.command,
        output: result.output,
        output_file: result.outputFile,
        started_at: result.startedAt,
        completed_at: result.completedAt,
        stopped_at: result.stoppedAt,
        stop_reason: result.stopReason,
        mode: result.mode,
        command_id: result.commandId,
        exit_code: result.exitCode,
        cwd: result.cwd,
        output_truncated: result.outputTruncated,
        lifetime_seconds: result.lifetimeSeconds,
        expires_at: result.expiresAt
      };
    }
    case "start": {
      const result = await startPersistentShellSession({
        ...persistentShellContext(run, request.envOverrides),
        command: request.command ?? undefined,
        mode: request.mode ?? undefined,
        lifetimeSeconds: request.lifetimeSeconds ?? null
      });
      return {
        session_id: result.sessionId,
        status: request.command ? "running" : "idle",
        lifetime_seconds: result.lifetimeSeconds,
        expires_at: result.expiresAt,
        sandbox_limits: {
          memory_mb: result.limits.memoryMb,
          cpus: result.limits.cpus,
          pids: result.limits.pids
        }
      };
    }
    case "stop":
      await stopPersistentShellSession({ sessionId: request.sessionId, environmentId });
      return { status: "stopped" };
    case "control": {
      const result = await controlPersistentShellSession({
        sessionId: request.sessionId,
        environmentId,
        action: request.control,
        data: request.data,
        cols: request.cols,
        rows: request.rows
      });
      return {
        session_id: request.sessionId, status: result.status,
        command_id: result.commandId, exit_code: result.exitCode, cwd: result.cwd,
        mode: result.mode, output_truncated: result.outputTruncated,
        bytes_accepted: result.bytesAccepted, complete: result.complete,
        status_sync_pending: result.statusSyncPending
      };
    }
    case "run": {
      const result = await runPersistentShellCommand({
        ...persistentShellContext(run, request.envOverrides),
        command: request.command,
        sessionId: request.sessionId,
        force: request.force
      });
      return {
        session_id: result.sessionId,
        status: result.status,
        command: request.command,
        background: true,
        command_id: result.commandId
      };
    }
  }
}

// Server tools for one run, executed with the identity the control plane resolved for it.
export function createDbPlatformToolHost(requireRun: () => ServerRunState): PlatformToolHost {
  const scope = () => {
    const run = requireRun();
    return {
      run,
      taskId: run.job.taskId,
      workspaceId: run.snapshot.task.workspace_id,
      environmentId: run.snapshot.task.environment_id,
      actorUserId: run.bootstrap.runActorUserId
    };
  };
  return {
    async queryTasks(filters) {
      const { run, taskId, environmentId } = scope();
      const results = await queryTasks(taskId, environmentId, filters);
      if (!run.bootstrap.isProjectMaster) return results;
      const listened = await loadListenedTaskIds(taskId, results.tasks.map((task) => task.task_id));
      return { ...results, tasks: results.tasks.map((task) => ({ ...task, listening: listened.has(task.task_id) })) };
    },
    viewTaskHistory: ({ taskId, maxMessages }) => viewTaskHistory(taskId, scope().environmentId, maxMessages),
    readOrganizedTaskHistory: ({ args, branchLeafId, allowOtherTasks, staged }) => {
      const { taskId, environmentId } = scope();
      return readOrganizedTaskHistory(args, { taskId, environmentId, branchLeafId, allowOtherTasks, staged: staged ?? undefined });
    },
    searchMemory: (input) => {
      const { run, environmentId } = scope();
      return searchMemoryIndex({ workspaceRoot: run.bootstrap.roots.workspaceRoot, currentProjectId: environmentId, ...input });
    },
    createRecurringTask: (input) => {
      const { run, taskId, workspaceId, environmentId } = scope();
      return createRecurringTaskFromTool({
        parentTaskId: taskId,
        workspaceId,
        environmentId,
        source: run.snapshot.task.source,
        connectorContextId: run.snapshot.task.connector_context_id,
        defaultTimezone: run.snapshot.task.default_timezone || "UTC",
        ...input
      });
    },
    editCurrentTaskSchedule: (input) => editCurrentTaskSchedule({ taskId: scope().taskId, ...input }),
    pauseRecurringSchedule: () => pauseRecurringSchedule(scope().taskId),
    applyInfiniteWait: (seconds) => applyInfiniteWait(scope().taskId, seconds),
    createSubtask: (input) => {
      const { taskId, workspaceId, environmentId } = scope();
      return createSubtaskFromTool({ parentTaskId: taskId, workspaceId, environmentId, ...input });
    },
    startSubtasks: (input) => {
      const { taskId, workspaceId, environmentId } = scope();
      return startSubtasksFromTool({ parentTaskId: taskId, workspaceId, environmentId, ...input });
    },
    liveSyncStatus: ({ taskRelativePath }) => {
      const { taskId, workspaceId, actorUserId } = scope();
      return fetchTaskLiveSyncStatus({ userId: actorUserId, taskId, workspaceId, taskRelativePath });
    },
    liveSyncTransfer: ({ action, taskRelativePath, force }) => {
      const { taskId, workspaceId, actorUserId } = scope();
      const transfer = action === "pull" ? pullTaskLiveSyncFile : pushTaskLiveSyncFile;
      return transfer({ userId: actorUserId, taskId, workspaceId, taskRelativePath, force });
    },
    liveSyncFolderSearch: (input) => {
      const { taskId, workspaceId, actorUserId } = scope();
      return searchTaskLiveSyncFolder({ userId: actorUserId, taskId, workspaceId, ...input });
    },
    createProjectCanvas: (input) => insertProjectCanvas(scope().run, input),
    async recordProjectCanvasEntry({ canvasId, entryPath }) {
      const { taskId, environmentId } = scope();
      await query(
        `UPDATE project_canvases
            SET entry_path = $2,
                last_task_id = $3,
                updated_at = now()
          WHERE id = $1 AND environment_id = $4`,
        [canvasId, entryPath, taskId, environmentId]
      );
    },
    markArtifacts: ({ artifacts }) => markTaskArtifacts(scope().taskId, artifacts, scope().run.job.executionTarget?.kind === "local"),
    unmarkArtifacts: ({ relativePaths }) => unmarkTaskArtifacts(scope().taskId, relativePaths),
    refreshGitHubToken: () => scope().run.refreshGitHubToken(),
    async issueSourceAccess({ sourceId, provider, ticketScope }) {
      const { run, taskId, workspaceId, actorUserId } = scope();
      return buildSourceRuntimeEnv({
        userId: actorUserId ?? "system-source-run",
        taskId,
        taskDir: run.taskDir,
        workspaceId,
        workspaceRoot: run.bootstrap.roots.workspaceRoot,
        sourceId,
        provider,
        ticketScope
      });
    },
    getDesktopComputerPresence: () => getDesktopComputerPresence(scope().actorUserId),
    requestDesktopComputerAction: (input) => {
      const { run, taskId } = scope();
      return requestDesktopComputerAction({ userId: requireActor(run, "Computer use"), taskId, ...input });
    },
    persistentShell: (request) => runPersistentShellRequest(scope().run, request),
    async readShellSessionWaitState({ sessionId }) {
      const { run, environmentId } = scope();
      const session = await getPersistentShellSessionStatus({ sessionId, environmentId, taskDir: run.taskDir });
      return {
        sessionId: session.sessionId,
        status: session.status,
        commandId: session.commandId,
        exitCode: session.exitCode,
        output: session.output,
        outputTruncated: session.outputTruncated,
        outputVersion: session.outputVersion ?? null,
        stopReason: session.stopReason ?? null
      };
    }
  };
}
