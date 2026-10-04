import { randomUUID } from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { createTaskMessageMetadata, ensureSandboxWritablePath, isWithinPath } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";

const RESERVED_CHILD_TASK_DIR_NAMES = new Set(["threads", "subtasks"]);

interface ForkSourceTaskRow {
  title: string | null;
  task_root_path: string;
  environment_id: string;
  environment_workspace_id: string;
  environment_root_path: string;
}

interface EnvironmentRow {
  id: string;
  workspace_id: string;
  root_path: string;
}

interface ForkSourceMessageRow {
  id: string;
  role: string;
  content_json: Record<string, unknown>;
  message_metadata_json: Record<string, unknown> | null;
  token_usage_json: Record<string, unknown> | null;
  source_ref: string | null;
  author_user_id: string | null;
  parent_message_id: string | null;
  edited_from_message_id: string | null;
  created_at: string;
}

function buildForkTitle(sourceTitle: string | null, requestedTitle: string | undefined): string {
  const normalizedSourceTitle = sourceTitle?.trim() || "Untitled Task";
  const forkTitleCandidate = requestedTitle?.trim() || `${normalizedSourceTitle} (Fork)`;
  return forkTitleCandidate.slice(0, 240);
}

function resolveTaskWorkspacePath(envRoot: string, taskRootPath: string): string {
  const resolvedEnvRoot = path.resolve(envRoot);
  const resolvedTaskPath = path.resolve(resolvedEnvRoot, taskRootPath);

  if (!isWithinPath(resolvedEnvRoot, resolvedTaskPath)) {
    throw new Error("Task root path escapes the environment root.");
  }

  return resolvedTaskPath;
}

async function loadForkSourceTask(sourceTaskId: string): Promise<ForkSourceTaskRow> {
  const sourceTaskRes = await query<ForkSourceTaskRow>(
    `SELECT t.title,
            t.task_root_path,
            t.environment_id,
            e.workspace_id AS environment_workspace_id,
            e.root_path AS environment_root_path
       FROM tasks t
       JOIN environments e
         ON e.id = t.environment_id
      WHERE t.id = $1`,
    [sourceTaskId]
  );

  if ((sourceTaskRes.rowCount ?? 0) === 0) {
    throw new Error("Task not found");
  }

  return sourceTaskRes.rows[0];
}

async function loadEnvironment(environmentId: string): Promise<EnvironmentRow> {
  const environmentRes = await query<EnvironmentRow>(
    `SELECT id, workspace_id, root_path
       FROM environments
      WHERE id = $1`,
    [environmentId]
  );

  if ((environmentRes.rowCount ?? 0) === 0) {
    throw new Error("Project not found");
  }

  return environmentRes.rows[0];
}

async function insertForkTask(client: PoolClient, input: {
  destinationWorkspaceId: string;
  destinationEnvironmentId: string;
  userId: string;
  forkTitle: string;
}): Promise<string> {
  const forkTaskId = randomUUID();
  await client.query(
    `INSERT INTO tasks (
      id,
      workspace_id,
      environment_id,
      title,
      status,
      source,
      initiator_user_id,
      task_root_path
    ) VALUES ($1, $2, $3, $4, 'awaiting_input', 'web', $5, $6)`,
    [
      forkTaskId,
      input.destinationWorkspaceId,
      input.destinationEnvironmentId,
      input.forkTitle,
      input.userId,
      `.meowbert/task-runs/${forkTaskId}`
    ]
  );
  return forkTaskId;
}

async function loadForkSourceMessages(client: PoolClient, input: {
  sourceTaskId: string;
  lineageMessageIds?: string[] | null;
}): Promise<ForkSourceMessageRow[]> {
  const sourceMessages = await client.query<ForkSourceMessageRow>(
    input.lineageMessageIds
      ? `SELECT
           id,
           role,
           content_json,
           message_metadata_json,
           token_usage_json,
           source_ref,
           author_user_id,
           parent_message_id,
           edited_from_message_id,
           created_at
         FROM task_messages
         WHERE task_id = $1
           AND id = ANY($2::uuid[])`
      : `SELECT
           id,
           role,
           content_json,
           message_metadata_json,
           token_usage_json,
           source_ref,
           author_user_id,
           parent_message_id,
           edited_from_message_id,
           created_at
         FROM task_messages
         WHERE task_id = $1
         ORDER BY created_at ASC, id ASC`,
    input.lineageMessageIds ? [input.sourceTaskId, input.lineageMessageIds] : [input.sourceTaskId]
  );

  if (!input.lineageMessageIds) {
    return sourceMessages.rows;
  }

  return input.lineageMessageIds
    .map((messageId) => sourceMessages.rows.find((row) => row.id === messageId) ?? null)
    .filter((row): row is ForkSourceMessageRow => row !== null);
}

async function insertForkMessages(client: PoolClient, input: {
  forkTaskId: string;
  sourceMessages: ForkSourceMessageRow[];
}): Promise<void> {
  const idMap = new Map<string, string>();
  const createdAtBase = Date.now();

  for (let index = 0; index < input.sourceMessages.length; index += 1) {
    const sourceMessage = input.sourceMessages[index];
    const parentMessageId = sourceMessage.parent_message_id
      ? (idMap.get(sourceMessage.parent_message_id) ?? null)
      : null;
    const editedFromMessageId = sourceMessage.edited_from_message_id
      ? (idMap.get(sourceMessage.edited_from_message_id) ?? null)
      : null;
    const createdAt = new Date(createdAtBase + index).toISOString();
    const messageMetadata = sourceMessage.role === "tool"
      ? null
      : (sourceMessage.message_metadata_json ?? createTaskMessageMetadata(sourceMessage.created_at));

    const insertedMessage = await client.query<{ id: string }>(
      `INSERT INTO task_messages (
        task_id,
        role,
        content_json,
        message_metadata_json,
        token_usage_json,
        source_ref,
        author_user_id,
        parent_message_id,
        edited_from_message_id,
        created_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        input.forkTaskId,
        sourceMessage.role,
        JSON.stringify(sourceMessage.content_json),
        messageMetadata ? JSON.stringify(messageMetadata) : null,
        sourceMessage.token_usage_json ? JSON.stringify(sourceMessage.token_usage_json) : null,
        sourceMessage.source_ref,
        sourceMessage.author_user_id,
        parentMessageId,
        editedFromMessageId,
        createdAt
      ]
    );

    idMap.set(sourceMessage.id, insertedMessage.rows[0].id);
  }
}

async function copyTaskWorkspaceContents(input: {
  sourceEnvRoot: string;
  sourceTaskRootPath: string;
  destinationEnvRoot: string;
  destinationTaskRootPath: string;
}): Promise<void> {
  const sourceTaskDir = resolveTaskWorkspacePath(input.sourceEnvRoot, input.sourceTaskRootPath);
  const destinationTaskDir = resolveTaskWorkspacePath(input.destinationEnvRoot, input.destinationTaskRootPath);
  const sourceStats = await fsPromises.stat(sourceTaskDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });

  if (!sourceStats) {
    return;
  }
  if (!sourceStats.isDirectory()) {
    throw new Error("Source task workspace is not a directory.");
  }

  await fsPromises.mkdir(destinationTaskDir, { recursive: true });
  const sourceEntries = await fsPromises.readdir(sourceTaskDir, { withFileTypes: true });

  for (const entry of sourceEntries) {
    if (entry.isDirectory() && RESERVED_CHILD_TASK_DIR_NAMES.has(entry.name)) {
      continue;
    }

    await fsPromises.cp(
      path.join(sourceTaskDir, entry.name),
      path.join(destinationTaskDir, entry.name),
      { recursive: true }
    );
  }

  // The copies keep the modes of files the sandbox wrote, so open them up for the sandbox once here.
  await ensureSandboxWritablePath({
    rootPath: input.destinationEnvRoot,
    targetPath: destinationTaskDir,
    recursive: true
  });
}

async function rollbackForkTaskOnFileCopyFailure(input: {
  forkTaskId: string;
  destinationEnvRoot: string;
  destinationTaskRootPath: string;
}): Promise<void> {
  const destinationTaskDir = resolveTaskWorkspacePath(input.destinationEnvRoot, input.destinationTaskRootPath);

  const cleanupResults = await Promise.allSettled([
    query(
      `DELETE FROM tasks
        WHERE id = $1`,
      [input.forkTaskId]
    ),
    fsPromises.rm(destinationTaskDir, { recursive: true, force: true })
  ]);

  const rejected = cleanupResults.find((result) => result.status === "rejected");
  if (rejected) {
    console.error("Failed to fully rollback task fork after file-copy error.", rejected.reason);
  }
}

export async function cloneTaskIntoFork(input: {
  sourceTaskId: string;
  destinationWorkspaceId: string;
  destinationEnvironmentId: string;
  userId: string;
  lineageMessageIds?: string[] | null;
  title?: string;
  copyTaskFiles?: boolean;
}): Promise<{ taskId: string; workspaceId: string; environmentId: string }> {
  const sourceTask = await loadForkSourceTask(input.sourceTaskId);
  const forkTitle = buildForkTitle(sourceTask.title, input.title);

  const fork = await withTransaction(async (client) => {
    const forkTaskId = await insertForkTask(client, {
      destinationWorkspaceId: input.destinationWorkspaceId,
      destinationEnvironmentId: input.destinationEnvironmentId,
      userId: input.userId,
      forkTitle
    });
    const sourceMessages = await loadForkSourceMessages(client, input);
    await insertForkMessages(client, { forkTaskId, sourceMessages });

    return {
      taskId: forkTaskId,
      workspaceId: input.destinationWorkspaceId,
      environmentId: input.destinationEnvironmentId,
      taskRootPath: `.meowbert/task-runs/${forkTaskId}`
    };
  });

  if (input.copyTaskFiles !== true) {
    return {
      taskId: fork.taskId,
      workspaceId: fork.workspaceId,
      environmentId: fork.environmentId
    };
  }

  const sourceEnvRoot = await ensureEnvironmentStorageRoot({
    id: sourceTask.environment_id,
    workspace_id: sourceTask.environment_workspace_id,
    root_path: sourceTask.environment_root_path
  });

  let destinationEnvRoot = sourceEnvRoot;
  if (input.destinationEnvironmentId !== sourceTask.environment_id) {
    const destinationEnvironment = await loadEnvironment(input.destinationEnvironmentId);
    destinationEnvRoot = await ensureEnvironmentStorageRoot(destinationEnvironment);
  }

  try {
    await copyTaskWorkspaceContents({
      sourceEnvRoot,
      sourceTaskRootPath: sourceTask.task_root_path,
      destinationEnvRoot,
      destinationTaskRootPath: fork.taskRootPath
    });
  } catch (error) {
    await rollbackForkTaskOnFileCopyFailure({
      forkTaskId: fork.taskId,
      destinationEnvRoot,
      destinationTaskRootPath: fork.taskRootPath
    });
    console.error("Failed to copy task workspace while creating a fork.", error);
    throw new Error("Failed to clone task environment files.");
  }

  return {
    taskId: fork.taskId,
    workspaceId: fork.workspaceId,
    environmentId: fork.environmentId
  };
}
