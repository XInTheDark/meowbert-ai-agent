import path from "node:path";
import { z } from "zod";
import type { NormalizedTaskHistoryArchiveConfig, TaskHistoryArchiveDocument } from "./task-history-archive.js";
import { readArchiveJson, writeArchiveJson } from "./task-history-archive-files.js";
import { ARCHIVE_SECTIONS, archivePayloadId, archiveSection, documentFromSections,
  type ArchivePayload, type TaskArchiveSection, type TaskArchiveManifest, type TaskArchiveReference } from "./task-history-archive-sections.js";

const identity = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), environment_id: z.string().uuid(),
  archived_at: z.string(), last_active_at: z.string() });
const manifestSchema = z.object({ version: z.literal(2), task: identity, sections: z.record(z.string(), z.array(
  z.object({ key: z.string(), ids: z.array(z.string()), bytes: z.number().nonnegative() }))) });
const chunkSchema = z.object({ version: z.literal(2), task_id: z.string().uuid(), kind: z.string(), items: z.array(z.record(z.string(), z.unknown())) });

export function taskArchiveDirectory(document: TaskHistoryArchiveDocument): string {
  return path.posix.join("v2/workspaces", document.task.workspace_id, "environments", document.task.environment_id, "tasks", document.task.id);
}

export async function readArchiveChunk(config: NormalizedTaskHistoryArchiveConfig, key: string, taskId: string, kind: TaskArchiveSection): Promise<ArchivePayload[]> {
  const chunk = chunkSchema.parse(await readArchiveJson(config, key));
  if (chunk.task_id !== taskId || chunk.kind !== kind) throw new Error("Archive chunk does not belong to the requested task or section.");
  return chunk.items;
}

export async function writeArchiveSection(config: NormalizedTaskHistoryArchiveConfig, document: TaskHistoryArchiveDocument, kind: TaskArchiveSection, items: ArchivePayload[]) {
  const chunks: NonNullable<TaskArchiveManifest["sections"][TaskArchiveSection]> = [];
  const references: TaskArchiveReference[] = [];
  let batch: ArchivePayload[] = [];
  let bytes = 0;
  let compressedSizeBytes = 0;
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const written = await writeArchiveJson(config, `${taskArchiveDirectory(document)}/chunks`, { version: 2, task_id: document.task.id, kind, items: batch });
    const ids = batch.map((item) => archivePayloadId(kind, item));
    chunks.push({ key: written.key, ids, bytes: written.bytes });
    references.push(...ids.map((payload_id) => ({ kind, payload_id, archive_key: written.key })));
    compressedSizeBytes += written.compressedBytes;
    batch = []; bytes = 0;
  };
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item));
    if (batch.length >= (kind === "media" ? 1 : 128) || (batch.length && bytes + size > 2_000_000)) await flush();
    batch.push(item); bytes += size;
  }
  await flush();
  return { chunks, references, compressedSizeBytes };
}

export async function writeTaskArchive(config: NormalizedTaskHistoryArchiveConfig, document: TaskHistoryArchiveDocument) {
  const manifest: TaskArchiveManifest = { version: 2, task: document.task, sections: {} };
  const references: TaskArchiveReference[] = [];
  let compressedSizeBytes = 0;
  for (const kind of Object.keys(ARCHIVE_SECTIONS) as TaskArchiveSection[]) {
    const written = await writeArchiveSection(config, document, kind, archiveSection(document, kind));
    manifest.sections[kind] = written.chunks;
    references.push(...written.references);
    compressedSizeBytes += written.compressedSizeBytes;
  }
  const published = await writeArchiveJson(config, `${taskArchiveDirectory(document)}/manifests`, manifest);
  return { archiveKey: published.key, references, originalSizeBytes: Buffer.byteLength(JSON.stringify(document)),
    compressedSizeBytes: compressedSizeBytes + published.compressedBytes };
}

export async function readTaskArchive(config: NormalizedTaskHistoryArchiveConfig, key: string, selection?: {
  kinds: TaskArchiveSection[]; ids: Partial<Record<TaskArchiveSection, string[]>>;
}): Promise<TaskHistoryArchiveDocument> {
  const value = await readArchiveJson(config, key);
  if ((value as { version?: unknown })?.version === 1) {
    identity.parse((value as TaskHistoryArchiveDocument).task);
    return value as TaskHistoryArchiveDocument;
  }
  const parsed = manifestSchema.parse(value);
  const manifest = parsed as TaskArchiveManifest;
  const sections: Partial<Record<TaskArchiveSection, ArchivePayload[]>> = {};
  for (const [kind, chunks] of Object.entries(manifest.sections)) {
    if (!(kind in ARCHIVE_SECTIONS)) throw new Error(`Unknown archive section: ${kind}`);
    if (selection && !selection.kinds.includes(kind as TaskArchiveSection)) continue;
    const selectedIds = selection?.ids[kind as TaskArchiveSection];
    sections[kind as TaskArchiveSection] = [];
    for (const chunk of chunks) {
      if (selectedIds && !chunk.ids.some((id) => selectedIds.includes(id))) continue;
      const items = await readArchiveChunk(config, chunk.key, manifest.task.id, kind as TaskArchiveSection);
      if (items.length !== chunk.ids.length || items.some((item, index) => archivePayloadId(kind as TaskArchiveSection, item) !== chunk.ids[index])) {
        throw new Error("Archive chunk identities do not match its manifest.");
      }
      sections[kind as TaskArchiveSection]!.push(...(selectedIds ? items.filter((item) => selectedIds.includes(archivePayloadId(kind as TaskArchiveSection, item))) : items));
    }
  }
  return documentFromSections(manifest, sections);
}
