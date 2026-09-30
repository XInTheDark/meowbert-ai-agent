import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { isProjectContextPath } from "@meowbert/shared/project-context";
import { query } from "../../lib/db.js";
import { createAvailableFilePath, sanitizeUploadFilename } from "../../routes/environments/shared.js";
import { getSourceCatalogEntry } from "../sources/source-catalog.js";
import { downloadWorkspaceSourceFile } from "../sources/source-operations.js";
import {
  createSourceFileLink,
  deleteSourceFileLink,
  getSourceFileLinkByEnvironmentPath,
  getTaskSourceFileLinkByEnvironmentPath,
  listTaskSourceFileLinkSummaries,
  listSourceFileLinksForEnvironmentPaths,
  listSourceFileLinksUnderEnvironmentPaths,
  setSourceFileLinkError,
  updateSourceFileLinkSyncBaseline
} from "./store.js";
import {
  readSourceFileLinkLocalSnapshot,
  stageSourceFileLinkUpload
} from "./local-file-state.js";
import { buildSourceFileLinkStatus } from "./status.js";
import {
  getSourceFileLinkRemoteProvider,
  SourceFileLinkRemoteMissingError
} from "./remote-provider.js";
import {
  SourceFileLinkActionError,
  SourceFileLinkAttachmentError,
  SourceFileLinkProviderError,
  type SourceFileLinkAttachmentStage
} from "./provider-errors.js";
import { createLiveSyncFileFromPath, replaceLiveSyncFileFromPath } from "./linux-safe-fs.js";
import {
  mirrorLocalFolderToRemote,
  mirrorRemoteFolderToLocal,
  readRemoteFolderSnapshot
} from "./folder-sync.js";
import type {
  SourceFileLink,
  SourceFileLinkProvider,
  SourceFileLinkStatusDetails,
  SourceFileLinkSummary
} from "./types.js";
import {
  acquireGoogleDriveFolderMount,
  getGoogleDriveFolderMountConsumers,
  releaseGoogleDriveFolderMountsForConsumer,
  unlinkGoogleDriveFolderMount
} from "./google-drive-mount-manager.js";

function sanitizeAttachmentDetail(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? error.message : fallback;
  return detail
    .replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function throwAttachmentStageError(stage: SourceFileLinkAttachmentStage, error: unknown, fallback: string): never {
  const detail = sanitizeAttachmentDetail(error, fallback);
  if (error instanceof SourceFileLinkProviderError || error instanceof SourceFileLinkActionError) {
    error.message = `Google Drive live folder attachment failed during ${stage}: ${detail}`;
    (error as Error & { stage?: SourceFileLinkAttachmentStage }).stage = stage;
    throw error;
  }

  throw new SourceFileLinkAttachmentError(stage, detail);
}

function resolveLiveSyncProviderForSource(sourceId: string): SourceFileLinkProvider {
  const source = getSourceCatalogEntry(sourceId);
  if (
    !source
    || (
      source.provider !== "onedrive"
      && source.provider !== "google-drive"
      && source.provider !== "pcloud"
      && source.provider !== "rclone"
    )
  ) {
    throw new Error("Live sync is only supported for OneDrive, Google Drive, pCloud, and rclone file sources.");
  }
  return source.provider;
}

function normalizeRelativePath(value: string, label: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  const resolved = path.posix.normalize(normalized);
  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw new Error(`${label} must stay within the task or environment filesystem.`);
  }
  return resolved;
}

function buildTaskScopedRelativePath(taskRootPath: string, taskRelativePath: string): string {
  return path.posix.join(
    normalizeRelativePath(taskRootPath, "Task root path"),
    normalizeRelativePath(taskRelativePath, "Live sync path")
  );
}

async function createLiveSyncDestination(input: {
  environmentRootPath: string;
  destinationPath?: string | null;
  filename: string;
}): Promise<{ relativePath: string; absolutePath: string }> {
  const rootRealPath = await fsPromises.realpath(input.environmentRootPath);
  const requestedDirectory = input.destinationPath?.trim().replace(/\\/g, "/") || ".";
  const normalizedDirectory = path.posix.normalize(requestedDirectory);
  if (normalizedDirectory === ".." || normalizedDirectory.startsWith("../") || path.posix.isAbsolute(normalizedDirectory)) {
    throw new Error("Live sync destination must stay within the environment filesystem.");
  }
  const targetDirectory = path.resolve(rootRealPath, normalizedDirectory);
  if (targetDirectory !== rootRealPath && !targetDirectory.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error("Live sync destination must stay within the environment filesystem.");
  }
  const preferredPath = path.join(targetDirectory, sanitizeUploadFilename(input.filename));
  const absolutePath = await createAvailableFilePath(preferredPath);
  return {
    absolutePath,
    relativePath: path.relative(rootRealPath, absolutePath).split(path.sep).join("/")
  };
}

async function replaceFileSafely(input: {
  tempFilePath: string;
  environmentRootPath: string;
  localRelativePath: string;
  createNewTarget?: boolean;
  createParents?: boolean;
}): Promise<void> {
  const helperInput = {
    environmentRootPath: input.environmentRootPath,
    localRelativePath: input.localRelativePath,
    sourcePath: input.tempFilePath
  };
  if (input.createNewTarget) {
    await createLiveSyncFileFromPath({
      ...helperInput,
      createParents: input.createParents !== false
    });
    return;
  }
  await replaceLiveSyncFileFromPath(helperInput);
}

async function writeRemoteDownloadToPath(input: {
  response: Response;
  environmentRootPath: string;
  localRelativePath: string;
  createNewTarget?: boolean;
  createParents?: boolean;
}): Promise<void> {
  if (!input.response.body) {
    throw new Error("Live sync download returned an empty body.");
  }

  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-live-sync-"));
  const tempFilePath = path.join(tempDir, `download-${randomUUID()}`);

  try {
    await pipeline(
      Readable.fromWeb(input.response.body as unknown as NodeReadableStream),
      fs.createWriteStream(tempFilePath)
    );
    await replaceFileSafely({
      tempFilePath,
      environmentRootPath: input.environmentRootPath,
      localRelativePath: input.localRelativePath,
      createNewTarget: input.createNewTarget,
      createParents: input.createParents
    });
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function resolveLinkStatus(input: {
  link: SourceFileLink;
  environmentRootPath: string;
}): Promise<SourceFileLinkStatusDetails> {
  if (input.link.provider === "google-drive" && input.link.linkKind === "folder") {
    throw new SourceFileLinkActionError(
      "This Google Drive folder streams files on demand and uploads file changes automatically. Manual status, pull, and push do not apply. Use Google Workspace tools for its native Google files."
    );
  }
  const local = await readSourceFileLinkLocalSnapshot({
    environmentRootPath: input.environmentRootPath,
    localRelativePath: input.link.localRelativePath,
    includeHash: true
  });

  try {
    const remoteProvider = getSourceFileLinkRemoteProvider(input.link.provider);
    const remote = input.link.linkKind === "folder"
      ? await readRemoteFolderSnapshot({ link: input.link, remoteProvider })
      : await remoteProvider.fetchRemoteSnapshot({
          workspaceId: input.link.workspaceId,
          sourceId: input.link.sourceId,
          itemId: input.link.remoteItemId
        });

    return buildSourceFileLinkStatus({
      link: input.link,
      local,
      remote
    });
  } catch (error) {
    if (error instanceof SourceFileLinkRemoteMissingError) {
      return buildSourceFileLinkStatus({
        link: input.link,
        local,
        remote: null
      });
    }

    return buildSourceFileLinkStatus({
      link: input.link,
      local,
      remote: null,
      remoteFetchError: error instanceof Error ? error.message : String(error)
    });
  }
}

function summarizeSourceFileLink(link: SourceFileLink): SourceFileLinkSummary {
  return {
    id: link.id,
    provider: link.provider,
    sourceId: link.sourceId,
    linkKind: link.linkKind,
    remoteName: link.remoteName,
    remoteWebUrl: link.remoteWebUrl,
    localRelativePath: link.localRelativePath,
    lastPulledAt: link.lastPulledAt,
    lastPushedAt: link.lastPushedAt,
    lastSyncError: link.lastSyncError
  };
}

async function requireSourceFileLinkByEnvironmentPath(input: {
  environmentId: string;
  localRelativePath: string;
}): Promise<SourceFileLink> {
  const normalizedPath = normalizeRelativePath(input.localRelativePath, "Live sync path");
  const link = await getSourceFileLinkByEnvironmentPath(input.environmentId, normalizedPath);
  if (!link) {
    throw new Error("Live sync file not found.");
  }
  return link;
}

async function resolveTaskLiveSyncContext(taskId: string): Promise<{
  taskRootPath: string;
  environmentId: string;
  workspaceId: string;
  environmentRootPath: string;
  workspaceRootPath: string;
}> {
  const result = await query<{
    task_root_path: string;
    environment_id: string;
    workspace_id: string;
    environment_root_path: string;
    workspace_root_path: string;
  }>(
    `SELECT t.task_root_path,
            t.environment_id,
            t.workspace_id,
            e.root_path AS environment_root_path,
            w.root_path AS workspace_root_path
       FROM tasks t
       JOIN environments e ON e.id = t.environment_id
       JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.id = $1`,
    [taskId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Task not found.");
  }

  return {
    taskRootPath: result.rows[0].task_root_path,
    environmentId: result.rows[0].environment_id,
    workspaceId: result.rows[0].workspace_id,
    environmentRootPath: result.rows[0].environment_root_path,
    workspaceRootPath: result.rows[0].workspace_root_path
  };
}

function toTaskLiveSyncSummary(input: {
  summary: SourceFileLinkSummary;
  normalizedTaskRoot: string;
}): Array<SourceFileLinkSummary & { taskRelativePath: string }> {
  const normalizedLocalPath = normalizeRelativePath(input.summary.localRelativePath, "Local live sync path");
  if (
    normalizedLocalPath === input.normalizedTaskRoot
    || normalizedLocalPath.startsWith(`${input.normalizedTaskRoot}/`)
  ) {
    const taskRelativePath = normalizedLocalPath.slice(input.normalizedTaskRoot.length).replace(/^\/+/, "");
    return taskRelativePath
      ? [{
          ...input.summary,
          localRelativePath: normalizedLocalPath,
          taskRelativePath
        }]
      : [];
  }

  if (isProjectContextPath(normalizedLocalPath)) {
    return [{
      ...input.summary,
      localRelativePath: normalizedLocalPath,
      taskRelativePath: normalizedLocalPath
    }];
  }

  return [];
}

function dedupeTaskLiveSyncSummaries(
  summaries: Array<SourceFileLinkSummary & { taskRelativePath: string }>
): Array<SourceFileLinkSummary & { taskRelativePath: string }> {
  const seen = new Set<string>();
  const deduped: Array<SourceFileLinkSummary & { taskRelativePath: string }> = [];
  for (const summary of summaries) {
    if (seen.has(summary.taskRelativePath)) {
      continue;
    }
    seen.add(summary.taskRelativePath);
    deduped.push(summary);
  }
  return deduped;
}

async function listProjectContextSourceFileLinkSummaries(input: {
  taskId: string;
  environmentId: string;
  workspaceId: string;
}): Promise<SourceFileLinkSummary[]> {
  const result = await query<{
    id: string;
    provider: SourceFileLinkProvider;
    source_id: string;
    link_kind: SourceFileLink["linkKind"];
    remote_name: string;
    remote_web_url: string | null;
    local_relative_path: string;
    last_pulled_at: string | null;
    last_pushed_at: string | null;
    last_sync_error: string | null;
  }>(
    `SELECT id,
            provider,
            source_id,
            link_kind,
            remote_name,
            remote_web_url,
            local_relative_path,
            last_pulled_at::text,
            last_pushed_at::text,
            last_sync_error
       FROM source_file_links
      WHERE environment_id = $1
        AND workspace_id = $2
        AND (task_id IS NULL OR task_id = $3)
        AND (local_relative_path = 'context' OR local_relative_path LIKE 'context/%')
      ORDER BY local_relative_path ASC`,
    [input.environmentId, input.workspaceId, input.taskId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    sourceId: row.source_id,
    linkKind: row.link_kind,
    remoteName: row.remote_name,
    remoteWebUrl: row.remote_web_url,
    localRelativePath: row.local_relative_path,
    lastPulledAt: row.last_pulled_at,
    lastPushedAt: row.last_pushed_at,
    lastSyncError: row.last_sync_error
  }));
}

async function resolveTaskLiveSyncLocalPath(input: {
  taskId: string;
  taskRelativePath: string;
}): Promise<{
  task: Awaited<ReturnType<typeof resolveTaskLiveSyncContext>>;
  localRelativePath: string;
}> {
  const task = await resolveTaskLiveSyncContext(input.taskId);
  const normalizedTaskPath = normalizeRelativePath(input.taskRelativePath, "Task live sync path");
  const taskScopedPath = buildTaskScopedRelativePath(task.taskRootPath, normalizedTaskPath);
  const taskScopedLink = await getTaskSourceFileLinkByEnvironmentPath({
    taskId: input.taskId,
    workspaceId: task.workspaceId,
    localRelativePath: taskScopedPath
  });
  if (taskScopedLink) {
    return {
      task,
      localRelativePath: taskScopedPath
    };
  }

  if (isProjectContextPath(normalizedTaskPath)) {
    const contextLink = await getSourceFileLinkByEnvironmentPath(task.environmentId, normalizedTaskPath);
    if (
      contextLink?.workspaceId === task.workspaceId
      && (contextLink.taskId === null || contextLink.taskId === input.taskId)
    ) {
      return {
        task,
        localRelativePath: normalizedTaskPath
      };
    }
  }

  throw new Error("Live sync file not found for this task.");
}

async function unlinkSourceFileLink(link: SourceFileLink): Promise<void> {
  if (link.provider === "google-drive" && link.linkKind === "folder") {
    const activeTaskConsumers = getGoogleDriveFolderMountConsumers(link.id)
      .filter((consumerId) => !consumerId.startsWith("attachment:") && consumerId.includes(":"));
    if (activeTaskConsumers.length > 0) {
      throw new SourceFileLinkActionError(
        "This Google Drive folder is still attached to a running task. Stop that task before removing the folder."
      );
    }
    await unlinkGoogleDriveFolderMount(
      link.id,
      link.taskId ?? (link.createdByUserId ? `attachment:${link.createdByUserId}` : undefined)
    );
  }
  await deleteSourceFileLink(link.id);
}

export async function createLiveSyncSourceAttachment(input: {
  workspaceId: string;
  environmentId: string;
  environmentRootPath: string;
  workspaceRootPath: string;
  actorUserId: string;
  sourceId: string;
  itemId: string;
  taskId?: string | null;
  destinationPath?: string | null;
  createDirectories?: boolean;
}): Promise<{
  kind: "file" | "directory";
  name: string;
  relativePath: string;
  sizeBytes: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
  liveSync: SourceFileLinkSummary;
}> {
  const provider = resolveLiveSyncProviderForSource(input.sourceId);
  const remoteProvider = getSourceFileLinkRemoteProvider(provider);
  let remote;
  try {
    remote = await remoteProvider.fetchRemoteSnapshot({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      itemId: input.itemId,
      requireWriteAccess: true
    });
  } catch (error) {
    throwAttachmentStageError("remote metadata", error, "The remote item metadata could not be loaded.");
  }

  if (remote.kind === "folder") {
    let destination;
    try {
      destination = await createLiveSyncDestination({
        environmentRootPath: input.environmentRootPath,
        destinationPath: input.destinationPath,
        filename: remote.name
      });
    } catch (error) {
      throwAttachmentStageError("destination", error, "The project destination could not be prepared.");
    }

    let link;
    try {
      link = await createSourceFileLink({
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        taskId: input.taskId ?? null,
        provider,
        sourceId: input.sourceId,
        linkKind: "folder",
        remoteItemId: remote.itemId,
        remoteName: remote.name,
        remoteMimeType: remote.mimeType,
        remoteWebUrl: remote.webUrl,
        localRelativePath: destination.relativePath,
        lastSyncedRemoteEtag: null,
        lastSyncedRemoteCtag: null,
        lastSyncedRemoteModifiedAt: null,
        lastSyncedRemoteSizeBytes: null,
        lastSyncedLocalHash: null,
        lastSyncedLocalSizeBytes: null,
        lastSyncedLocalModifiedAt: null,
        actorUserId: input.actorUserId
      });
    } catch (error) {
      throwAttachmentStageError("link creation", error, "The attachment record could not be created.");
    }

    try {
      if (provider === "google-drive") {
        try {
          await acquireGoogleDriveFolderMount({
            link,
            consumerId: input.taskId ?? `attachment:${input.actorUserId}`,
            mountPoint: destination.absolutePath
          });
        } catch (error) {
          throwAttachmentStageError("live folder mount", error, "The live folder could not be mounted.");
        }
        return {
          kind: "directory",
          name: path.posix.basename(destination.relativePath),
          relativePath: destination.relativePath,
          sizeBytes: null,
          createdAt: null,
          modifiedAt: null,
          liveSync: summarizeSourceFileLink(link)
        };
      }
      const mirrored = await mirrorRemoteFolderToLocal({
        link,
        remoteProvider,
        environmentRootPath: input.environmentRootPath,
        createParents: input.createDirectories !== false
      });
      const updatedLink = await updateSourceFileLinkSyncBaseline({
        id: link.id,
        remoteName: mirrored.remote.name,
        remoteMimeType: mirrored.remote.mimeType,
        remoteWebUrl: mirrored.remote.webUrl,
        lastSyncedRemoteEtag: mirrored.remote.eTag,
        lastSyncedRemoteCtag: mirrored.remote.cTag,
        lastSyncedRemoteModifiedAt: mirrored.remote.modifiedAt,
        lastSyncedRemoteSizeBytes: mirrored.remote.sizeBytes,
        lastSyncedLocalHash: mirrored.local.hash,
        lastSyncedLocalSizeBytes: mirrored.local.sizeBytes,
        lastSyncedLocalModifiedAt: mirrored.local.modifiedAt,
        pulledAt: new Date().toISOString(),
        clearError: true,
        actorUserId: input.actorUserId
      });
      return {
        kind: "directory",
        name: path.posix.basename(destination.relativePath),
        relativePath: destination.relativePath,
        sizeBytes: mirrored.local.sizeBytes,
        createdAt: mirrored.local.modifiedAt,
        modifiedAt: mirrored.local.modifiedAt,
        liveSync: summarizeSourceFileLink(updatedLink)
      };
    } catch (error) {
      await deleteSourceFileLink(link.id).catch(() => undefined);
      throw error;
    }
  }

  const destination = await createLiveSyncDestination({
    environmentRootPath: input.environmentRootPath,
    destinationPath: input.destinationPath,
    filename: remote.name
  });
  const download = await downloadWorkspaceSourceFile({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    itemId: input.itemId
  });
  await writeRemoteDownloadToPath({
    response: download.response,
    environmentRootPath: input.environmentRootPath,
    localRelativePath: destination.relativePath,
    createNewTarget: true,
    createParents: input.createDirectories !== false
  });
  const local = await readSourceFileLinkLocalSnapshot({
    environmentRootPath: input.environmentRootPath,
    localRelativePath: destination.relativePath,
    includeHash: true
  });

  const link = await createSourceFileLink({
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    taskId: input.taskId ?? null,
    provider,
    sourceId: input.sourceId,
    linkKind: "file",
    remoteItemId: remote.itemId,
    remoteName: remote.name,
    remoteMimeType: remote.mimeType,
    remoteWebUrl: remote.webUrl,
    localRelativePath: destination.relativePath,
    lastSyncedRemoteEtag: remote.eTag,
    lastSyncedRemoteCtag: remote.cTag,
    lastSyncedRemoteModifiedAt: remote.modifiedAt,
    lastSyncedRemoteSizeBytes: remote.sizeBytes,
    lastSyncedLocalHash: local.hash,
    lastSyncedLocalSizeBytes: local.sizeBytes,
    lastSyncedLocalModifiedAt: local.modifiedAt,
    actorUserId: input.actorUserId
  });

  return {
    kind: "file",
    name: path.posix.basename(destination.relativePath),
    relativePath: destination.relativePath,
    sizeBytes: local.sizeBytes,
    createdAt: local.modifiedAt,
    modifiedAt: local.modifiedAt,
    liveSync: summarizeSourceFileLink(link)
  };
}

export async function getSourceFileLinkStatusByEnvironmentPath(input: {
  environmentId: string;
  environmentRootPath: string;
  localRelativePath: string;
}): Promise<SourceFileLinkStatusDetails> {
  const link = await requireSourceFileLinkByEnvironmentPath({
    environmentId: input.environmentId,
    localRelativePath: input.localRelativePath
  });

  return resolveLinkStatus({
    link,
    environmentRootPath: input.environmentRootPath
  });
}

export async function pullSourceFileLinkByEnvironmentPath(input: {
  environmentId: string;
  environmentRootPath: string;
  workspaceRootPath: string;
  actorUserId: string;
  localRelativePath: string;
  force?: boolean;
}): Promise<SourceFileLinkStatusDetails> {
  const link = await requireSourceFileLinkByEnvironmentPath({
    environmentId: input.environmentId,
    localRelativePath: input.localRelativePath
  });
  const status = await resolveLinkStatus({
    link,
    environmentRootPath: input.environmentRootPath
  });

  if (!status.remote) {
    throw new SourceFileLinkActionError(status.message ?? "The remote source file is missing.");
  }
  if (!status.canPull) {
    throw new SourceFileLinkActionError(status.message ?? "This file cannot be pulled right now.");
  }
  if (!input.force && (status.status === "local_modified" || status.status === "conflict")) {
    throw new SourceFileLinkActionError("The local file has unsynced edits. Pass force=true to discard local changes and pull the latest remote version.");
  }

  try {
    if (link.linkKind === "folder") {
      const remoteProvider = getSourceFileLinkRemoteProvider(link.provider);
      const mirrored = await mirrorRemoteFolderToLocal({
        link,
        remoteProvider,
        environmentRootPath: input.environmentRootPath
      });
      const updatedLink = await updateSourceFileLinkSyncBaseline({
        id: link.id,
        remoteName: mirrored.remote.name,
        remoteMimeType: mirrored.remote.mimeType,
        remoteWebUrl: mirrored.remote.webUrl,
        lastSyncedRemoteEtag: mirrored.remote.eTag,
        lastSyncedRemoteCtag: mirrored.remote.cTag,
        lastSyncedRemoteModifiedAt: mirrored.remote.modifiedAt,
        lastSyncedRemoteSizeBytes: mirrored.remote.sizeBytes,
        lastSyncedLocalHash: mirrored.local.hash,
        lastSyncedLocalSizeBytes: mirrored.local.sizeBytes,
        lastSyncedLocalModifiedAt: mirrored.local.modifiedAt,
        pulledAt: new Date().toISOString(),
        clearError: true,
        actorUserId: input.actorUserId
      });
      return buildSourceFileLinkStatus({
        link: updatedLink,
        local: mirrored.local,
        remote: mirrored.remote
      });
    } else {
      const download = await downloadWorkspaceSourceFile({
        workspaceId: link.workspaceId,
        sourceId: link.sourceId,
        itemId: link.remoteItemId
      });
      await writeRemoteDownloadToPath({
        response: download.response,
        environmentRootPath: input.environmentRootPath,
        localRelativePath: link.localRelativePath
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setSourceFileLinkError({
      id: link.id,
      error: message,
      actorUserId: input.actorUserId
    });
    throw error;
  }

  const local = await readSourceFileLinkLocalSnapshot({
    environmentRootPath: input.environmentRootPath,
    localRelativePath: link.localRelativePath,
    includeHash: true
  });
  const updatedLink = await updateSourceFileLinkSyncBaseline({
    id: link.id,
    remoteName: status.remote.name,
    remoteMimeType: status.remote.mimeType,
    remoteWebUrl: status.remote.webUrl,
    lastSyncedRemoteEtag: status.remote.eTag,
    lastSyncedRemoteCtag: status.remote.cTag,
    lastSyncedRemoteModifiedAt: status.remote.modifiedAt,
    lastSyncedRemoteSizeBytes: status.remote.sizeBytes,
    lastSyncedLocalHash: local.hash,
    lastSyncedLocalSizeBytes: local.sizeBytes,
    lastSyncedLocalModifiedAt: local.modifiedAt,
    pulledAt: new Date().toISOString(),
    clearError: true,
    actorUserId: input.actorUserId
  });

  return buildSourceFileLinkStatus({
    link: updatedLink,
    local,
    remote: status.remote
  });
}

export async function pushSourceFileLinkByEnvironmentPath(input: {
  environmentId: string;
  environmentRootPath: string;
  actorUserId: string;
  localRelativePath: string;
  force?: boolean;
}): Promise<SourceFileLinkStatusDetails> {
  const link = await requireSourceFileLinkByEnvironmentPath({
    environmentId: input.environmentId,
    localRelativePath: input.localRelativePath
  });
  const status = await resolveLinkStatus({
    link,
    environmentRootPath: input.environmentRootPath
  });

  if (!status.local.exists) {
    throw new SourceFileLinkActionError(status.message ?? "The local working copy is missing.");
  }
  if (!status.remote) {
    throw new SourceFileLinkActionError(status.message ?? "The remote source file is missing.");
  }
  if (status.status === "synced") {
    return status;
  }
  if (!(status.status === "local_modified" || status.status === "conflict" || (input.force && status.status === "remote_modified"))) {
    throw new SourceFileLinkActionError(status.message ?? "This file cannot be pushed right now.");
  }
  if (!input.force && status.status === "conflict") {
    throw new SourceFileLinkActionError("The remote source file also changed. Pass force=true to overwrite the remote file with the local working copy.");
  }

  let remoteAfter;
  let localAfter;
  try {
    const remoteProvider = getSourceFileLinkRemoteProvider(link.provider);
    if (link.linkKind === "folder") {
      const mirrored = await mirrorLocalFolderToRemote({
        link,
        remoteProvider,
        environmentRootPath: input.environmentRootPath
      });
      remoteAfter = mirrored.remote;
      localAfter = mirrored.local;
    } else {
      const stagedUpload = await stageSourceFileLinkUpload({
        environmentRootPath: input.environmentRootPath,
        localRelativePath: link.localRelativePath
      });
      try {
        remoteAfter = await remoteProvider.uploadRemoteFile({
          workspaceId: link.workspaceId,
          sourceId: link.sourceId,
          itemId: link.remoteItemId,
          localFilePath: stagedUpload.localFilePath,
          ifMatchEtag: input.force ? null : link.lastSyncedRemoteEtag
        });
      } finally {
        await stagedUpload.cleanup();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setSourceFileLinkError({
      id: link.id,
      error: message,
      actorUserId: input.actorUserId
    });
    throw error;
  }

  const local = localAfter ?? await readSourceFileLinkLocalSnapshot({
    environmentRootPath: input.environmentRootPath,
    localRelativePath: link.localRelativePath,
    includeHash: true
  });
  const updatedLink = await updateSourceFileLinkSyncBaseline({
    id: link.id,
    remoteName: remoteAfter.name,
    remoteMimeType: remoteAfter.mimeType,
    remoteWebUrl: remoteAfter.webUrl,
    lastSyncedRemoteEtag: remoteAfter.eTag,
    lastSyncedRemoteCtag: remoteAfter.cTag,
    lastSyncedRemoteModifiedAt: remoteAfter.modifiedAt,
    lastSyncedRemoteSizeBytes: remoteAfter.sizeBytes,
    lastSyncedLocalHash: local.hash,
    lastSyncedLocalSizeBytes: local.sizeBytes,
    lastSyncedLocalModifiedAt: local.modifiedAt,
    pushedAt: new Date().toISOString(),
    clearError: true,
    actorUserId: input.actorUserId
  });

  return buildSourceFileLinkStatus({
    link: updatedLink,
    local,
    remote: remoteAfter
  });
}

export async function unlinkSourceFileLinkByEnvironmentPath(input: {
  environmentId: string;
  localRelativePath: string;
}): Promise<void> {
  const link = await requireSourceFileLinkByEnvironmentPath({
    environmentId: input.environmentId,
    localRelativePath: input.localRelativePath
  });
  await unlinkSourceFileLink(link);
}

export async function unlinkSourceFileLinksUnderEnvironmentPaths(input: {
  environmentId: string;
  localRelativePaths: string[];
}): Promise<SourceFileLink[]> {
  const links = await listSourceFileLinksUnderEnvironmentPaths(
    input.environmentId,
    input.localRelativePaths
  );
  const activeTaskConsumers = links.flatMap((link) => (
    link.provider === "google-drive" && link.linkKind === "folder"
      ? getGoogleDriveFolderMountConsumers(link.id)
        .filter((consumerId) => !consumerId.startsWith("attachment:") && consumerId.includes(":"))
        .map((consumerId) => ({ link, consumerId }))
      : []
  ));
  if (activeTaskConsumers.length > 0) {
    throw new SourceFileLinkActionError(
      "A selected project path contains a Google Drive folder attached to a running task. Stop that task before removing it."
    );
  }

  for (const link of links) {
    await unlinkSourceFileLink(link);
  }
  return links;
}

export async function ensureTaskSourceFolderMounts(input: { taskId: string; consumerId: string }): Promise<string[]> {
  const task = await resolveTaskLiveSyncContext(input.taskId);
  const result = await query<{ local_relative_path: string }>(
    `SELECT local_relative_path FROM source_file_links
      WHERE environment_id = $1 AND workspace_id = $2
        AND link_kind = 'folder'
        AND (task_id = $3 OR (task_id IS NULL
          AND (local_relative_path = 'context' OR local_relative_path LIKE 'context/%')))`,
    [task.environmentId, task.workspaceId, input.taskId]
  );
  const links = await listSourceFileLinksForEnvironmentPaths(task.environmentId, result.rows.map((row) => row.local_relative_path));
  return Promise.all(links.filter((link) => link.provider === "google-drive").map((link) => acquireGoogleDriveFolderMount({
    link,
    consumerId: input.consumerId,
    mountPoint: path.resolve(task.environmentRootPath, link.localRelativePath)
  })));
}

export async function releaseTaskSourceFolderMounts(input: { taskId: string; consumerId: string }): Promise<void> {
  await releaseGoogleDriveFolderMountsForConsumer(input.consumerId);
}

export async function listTaskLiveSyncFileSummaries(input: {
  taskId: string;
}): Promise<Array<SourceFileLinkSummary & { taskRelativePath: string }>> {
  const task = await resolveTaskLiveSyncContext(input.taskId);
  const [taskSummaries, projectContextSummaries] = await Promise.all([
    listTaskSourceFileLinkSummaries({
      taskId: input.taskId,
      workspaceId: task.workspaceId
    }),
    listProjectContextSourceFileLinkSummaries({
      taskId: input.taskId,
      environmentId: task.environmentId,
      workspaceId: task.workspaceId
    })
  ]);
  const normalizedTaskRoot = normalizeRelativePath(task.taskRootPath, "Task root path");

  return dedupeTaskLiveSyncSummaries(
    [...taskSummaries, ...projectContextSummaries].flatMap((summary) => toTaskLiveSyncSummary({
      summary,
      normalizedTaskRoot
    }))
  );
}

export async function getTaskLiveSyncStatusByTaskPath(input: {
  taskId: string;
  taskRelativePath: string;
}): Promise<SourceFileLinkStatusDetails> {
  const { task, localRelativePath } = await resolveTaskLiveSyncLocalPath(input);
  const link = await getSourceFileLinkByEnvironmentPath(task.environmentId, localRelativePath);
  if (!link) {
    throw new Error("Live sync file not found for this task.");
  }

  return resolveLinkStatus({
    link,
    environmentRootPath: task.environmentRootPath
  });
}

export async function pullTaskLiveSyncFileByTaskPath(input: {
  taskId: string;
  actorUserId: string;
  taskRelativePath: string;
  force?: boolean;
}): Promise<SourceFileLinkStatusDetails> {
  const { task, localRelativePath } = await resolveTaskLiveSyncLocalPath(input);
  return pullSourceFileLinkByEnvironmentPath({
    environmentId: task.environmentId,
    environmentRootPath: task.environmentRootPath,
    workspaceRootPath: task.workspaceRootPath,
    actorUserId: input.actorUserId,
    localRelativePath,
    force: input.force
  });
}

export async function pushTaskLiveSyncFileByTaskPath(input: {
  taskId: string;
  actorUserId: string;
  taskRelativePath: string;
  force?: boolean;
}): Promise<SourceFileLinkStatusDetails> {
  const { task, localRelativePath } = await resolveTaskLiveSyncLocalPath(input);
  return pushSourceFileLinkByEnvironmentPath({
    environmentId: task.environmentId,
    environmentRootPath: task.environmentRootPath,
    actorUserId: input.actorUserId,
    localRelativePath,
    force: input.force
  });
}
