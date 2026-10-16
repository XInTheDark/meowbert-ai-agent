import { createHash } from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_MEMORY_DIRNAME } from "@meowbert/shared";
import { getOpenAiClient } from "../agent/openai-client.js";
import { buildChunkContext, chunkMemoryFile } from "./chunking.js";
import {
  MEMORY_BINARY_SAMPLE_BYTES,
  MEMORY_EMBED_BATCH_SIZE,
  pathExists,
  type MemoryChunk,
  type MemoryIndexRow,
  type MemoryTrackedFile,
  type PersistedMemoryFileRecord,
  type ResolvedMemoryEmbeddingConfig
} from "./shared.js";

function isLikelyBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  if (
    buffer.length >= 2
    && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    return false;
  }

  let suspiciousBytes = 0;
  for (const byte of buffer.values()) {
    if (byte === 0) {
      return true;
    }

    const isAllowedWhitespace = byte === 9 || byte === 10 || byte === 12 || byte === 13;
    const isControlCharacter = byte < 32 || byte === 127;
    if (isControlCharacter && !isAllowedWhitespace) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / buffer.length > 0.1;
}

async function isSupportedMemoryFile(absolutePath: string): Promise<boolean> {
  const handle = await fsPromises.open(absolutePath, "r");
  try {
    const sample = Buffer.alloc(MEMORY_BINARY_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    if (bytesRead <= 0) {
      return false;
    }

    return !isLikelyBinaryBuffer(sample.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath: string): Promise<string> {
  const buffer = await fsPromises.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function scanMemoryFilesRecursive(
  rootDir: string,
  currentDir: string,
  results: MemoryTrackedFile[]
): Promise<void> {
  const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.resolve(currentDir, entry.name);

    if (entry.isDirectory()) {
      await scanMemoryFilesRecursive(rootDir, absolutePath, results);
      continue;
    }

    if (!entry.isFile() || !(await isSupportedMemoryFile(absolutePath))) {
      continue;
    }

    const stats = await fsPromises.stat(absolutePath);
    if (stats.size <= 0) {
      continue;
    }

    const relativeInsideMemory = path.relative(rootDir, absolutePath).split(path.sep).join("/");
    results.push({
      absolutePath,
      relativePath: `${WORKSPACE_MEMORY_DIRNAME}/${relativeInsideMemory}`,
      sha256: await hashFile(absolutePath),
      sizeBytes: stats.size,
      modifiedAtMs: stats.mtimeMs
    });
  }
}

export async function scanMemoryFiles(memoryDir: string): Promise<MemoryTrackedFile[]> {
  const results: MemoryTrackedFile[] = [];
  if (!(await pathExists(memoryDir))) {
    return results;
  }

  await scanMemoryFilesRecursive(memoryDir, memoryDir, results);
  results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return results;
}

export function diffTrackedFiles(
  previousFiles: Record<string, PersistedMemoryFileRecord> | null | undefined,
  currentFiles: MemoryTrackedFile[]
): { added: MemoryTrackedFile[]; removed: string[]; modified: MemoryTrackedFile[] } {
  const previous = previousFiles ?? {};
  const currentByPath = new Map(currentFiles.map((file) => [file.relativePath, file]));
  const added: MemoryTrackedFile[] = [];
  const modified: MemoryTrackedFile[] = [];

  for (const file of currentFiles) {
    const previousEntry = previous[file.relativePath];
    if (!previousEntry) {
      added.push(file);
      continue;
    }

    if (
      previousEntry.sha256 !== file.sha256
      || previousEntry.sizeBytes !== file.sizeBytes
      || previousEntry.modifiedAtMs !== file.modifiedAtMs
    ) {
      modified.push(file);
    }
  }

  const removed = Object.keys(previous).filter((relativePath) => !currentByPath.has(relativePath));
  return { added, removed, modified };
}

function lineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function resolveLineNumber(offsets: number[], charIndex: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid] <= charIndex) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return Math.max(1, high + 1);
}

async function readUtf8(filePath: string): Promise<string> {
  return fsPromises.readFile(filePath, "utf8");
}

async function buildFileChunks(file: MemoryTrackedFile): Promise<MemoryChunk[]> {
  const text = await readUtf8(file.absolutePath);
  if (!text.trim()) {
    return [];
  }

  const chunked = chunkMemoryFile(file.relativePath, text);
  const offsets = lineStartOffsets(chunked.normalizedText);
  return chunked.chunks.map((chunk) => ({
    id: createHash("sha256").update(`${file.relativePath}:${chunk.start}:${chunk.end}:${chunk.text}`).digest("hex").slice(0, 32),
    text: chunk.text,
    context: buildChunkContext({
      relativePath: file.relativePath,
      headingPath: chunk.headingPath,
      description: chunked.description
    }),
    filePath: file.absolutePath,
    relativePath: file.relativePath,
    lineStart: resolveLineNumber(offsets, chunk.start),
    lineEnd: resolveLineNumber(offsets, Math.max(chunk.start, chunk.end - 1))
  }));
}

export function applyEmbeddingTemplate(
  template: string | null,
  text: string,
  context: {
    relativePath?: string;
    filePath?: string;
    lineStart?: number;
    lineEnd?: number;
  } = {}
): string {
  if (!template || template.trim().length === 0) {
    return text;
  }

  const replacements: Record<string, string> = {
    text,
    relative_path: context.relativePath ?? "",
    relativePath: context.relativePath ?? "",
    file_path: context.filePath ?? "",
    filePath: context.filePath ?? "",
    line_start: context.lineStart != null ? String(context.lineStart) : "",
    lineStart: context.lineStart != null ? String(context.lineStart) : "",
    line_end: context.lineEnd != null ? String(context.lineEnd) : "",
    lineEnd: context.lineEnd != null ? String(context.lineEnd) : ""
  };

  let rendered = template;
  let replaced = false;
  for (const [key, value] of Object.entries(replacements)) {
    const next = rendered.replaceAll(`{{${key}}}`, value).replaceAll(`{${key}}`, value);
    if (next !== rendered) {
      replaced = true;
      rendered = next;
    }
  }

  return replaced ? rendered : `${template}${text}`;
}

export async function embedTexts(
  texts: string[],
  embeddingConfig: ResolvedMemoryEmbeddingConfig
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const client = getOpenAiClient(embeddingConfig.provider);
  const vectors: number[][] = [];

  for (let index = 0; index < texts.length; index += MEMORY_EMBED_BATCH_SIZE) {
    const batch = texts.slice(index, index + MEMORY_EMBED_BATCH_SIZE);
    const response = await client.embeddings.create({
      model: embeddingConfig.model,
      input: batch
    });

    const sorted = [...response.data].sort((left, right) => left.index - right.index);
    for (const item of sorted) {
      vectors.push(Array.from(item.embedding));
    }
  }

  return vectors;
}

export async function buildIndexRows(
  files: MemoryTrackedFile[],
  embeddingConfig: ResolvedMemoryEmbeddingConfig
): Promise<MemoryIndexRow[]> {
  const chunks = (await Promise.all(files.map((file) => buildFileChunks(file)))).flat();
  if (chunks.length === 0) {
    return [];
  }

  const embeddingInputs = chunks.map((chunk) => applyEmbeddingTemplate(embeddingConfig.buildPromptTemplate, `${chunk.context}\n\n${chunk.text}`, {
    relativePath: chunk.relativePath,
    filePath: chunk.filePath,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd
  }));
  const vectors = await embedTexts(embeddingInputs, embeddingConfig);

  return chunks.map((chunk, index) => ({
    id: chunk.id,
    text: chunk.text,
    search_text: `${chunk.context}\n\n${chunk.text}`,
    file_path: chunk.filePath,
    relative_path: chunk.relativePath,
    line_start: chunk.lineStart,
    line_end: chunk.lineEnd,
    vector: vectors[index] ?? []
  }));
}
