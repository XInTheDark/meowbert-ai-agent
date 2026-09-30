import fs from "node:fs/promises";
import path from "node:path";
import type { FunctionTool, ResponseFunctionToolCall, ResponseInputItem } from "openai/resources/responses/responses";
import { isWithinPath } from "@meowbert/shared";
import { z } from "zod";

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";
const ASCII_APOSTROPHE = "\u0027";

export const APPLY_PATCH_TOOL_GRAMMAR = [
  "start: begin_patch hunk+ end_patch",
  'begin_patch: "*** Begin Patch" LF',
  'end_patch: "*** End Patch" LF?',
  "",
  "hunk: add_hunk | delete_hunk | update_hunk",
  'add_hunk: "*** Add File: " filename LF add_line+',
  'delete_hunk: "*** Delete File: " filename LF',
  'update_hunk: "*** Update File: " filename LF change_move? change?',
  "",
  "filename: /(.+)/",
  'add_line: "+" /(.*)/ LF -> line',
  "",
  'change_move: "*** Move to: " filename LF',
  'change: (change_context | change_line)+ eof_line?',
  'change_context: ("@@" | "@@ " /(.+)/) LF',
  'change_line: ("+" | "-" | " ") /(.*)/ LF',
  'eof_line: "*** End of File" LF',
  "",
  "%import common.LF"
].join("\n");

const createFileOperationSchema = z.object({
  type: z.literal("create_file"),
  path: z.string().min(1),
  diff: z.string()
}).passthrough();

const updateFileOperationSchema = z.object({
  type: z.literal("update_file"),
  path: z.string().min(1),
  diff: z.string(),
  move_to: z.string().min(1).optional()
}).passthrough();

const deleteFileOperationSchema = z.object({
  type: z.literal("delete_file"),
  path: z.string().min(1)
}).passthrough();

export const applyPatchOperationSchema = z.discriminatedUnion("type", [
  createFileOperationSchema,
  updateFileOperationSchema,
  deleteFileOperationSchema
]);

export type ApplyPatchOperation = z.infer<typeof applyPatchOperationSchema>;


export const applyPatchCustomToolDefinition = {
  type: "custom",
  name: "apply_patch",
  description:
    "Apply precise file edits using Codex apply_patch syntax. Send a full patch document between *** Begin Patch and *** End Patch.",
  format: {
    type: "grammar",
    syntax: "lark",
    definition: APPLY_PATCH_TOOL_GRAMMAR
  }
} as const;

export const applyPatchFunctionToolDefinition: FunctionTool = {
  type: "function",
  name: "apply_patch",
  description:
    "Apply precise file edits using Codex apply_patch syntax. Send a full patch document between *** Begin Patch and *** End Patch.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      patch: {
        type: "string",
        description: "Full Codex-style patch document between *** Begin Patch and *** End Patch."
      }
    },
    required: ["patch"],
    additionalProperties: false
  }
};

export const applyPatchCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal("apply_patch_call"),
  status: z.string().optional(),
  call_id: z.string().min(1),
  operation: applyPatchOperationSchema
}).passthrough();

export type ApplyPatchCall = z.infer<typeof applyPatchCallSchema>;

export const applyPatchCallOutputSchema = z.object({
  type: z.literal("apply_patch_call_output"),
  call_id: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  output: z.string().optional()
}).passthrough();

export type ApplyPatchCallOutput = z.infer<typeof applyPatchCallOutputSchema>;

export const applyPatchCustomToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal("custom_tool_call"),
  call_id: z.string().min(1),
  name: z.literal("apply_patch"),
  input: z.string()
}).passthrough();

export type ApplyPatchCustomToolCall = z.infer<typeof applyPatchCustomToolCallSchema>;

export const applyPatchFunctionToolArgumentsSchema = z.object({
  patch: z.string().min(1)
});

export type ApplyPatchFunctionToolCall = ResponseFunctionToolCall & {
  name: "apply_patch";
};

interface UpdateFileChunk {
  changeContext: string | null;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

export function isApplyPatchCallItem(value: unknown): value is ApplyPatchCall {
  return applyPatchCallSchema.safeParse(value).success;
}

export function isApplyPatchCallOutputItem(value: unknown): value is ApplyPatchCallOutput {
  return applyPatchCallOutputSchema.safeParse(value).success;
}

export function createApplyPatchCallOutput(
  callId: string,
  status: ApplyPatchCallOutput["status"],
  output: string
): ResponseInputItem {
  return {
    type: "apply_patch_call_output",
    call_id: callId,
    status,
    output
  } as unknown as ResponseInputItem;
}

export function isApplyPatchCustomToolCallItem(value: unknown): value is ApplyPatchCustomToolCall {
  return applyPatchCustomToolCallSchema.safeParse(value).success;
}

export function createApplyPatchCustomToolCallOutput(callId: string, output: string): ResponseInputItem {
  return {
    type: "custom_tool_call_output",
    call_id: callId,
    output
  } as unknown as ResponseInputItem;
}

export function createApplyPatchFunctionToolCallOutput(callId: string, output: string): ResponseInputItem {
  return {
    type: "function_call_output",
    call_id: callId,
    output
  } as unknown as ResponseInputItem;
}

export function parseApplyPatchDocument(patch: string): ApplyPatchOperation[] {
  const lines = patch.split(/\r?\n/).map((line) => line.replace(/\r$/, ""));
  if (lines.at(-1) === "") {
    lines.pop();
  }

  if (lines[0] !== BEGIN_PATCH_MARKER) {
    throw new Error(`Patch must start with "${BEGIN_PATCH_MARKER}"`);
  }

  if (lines.length < 2 || lines.at(-1) !== END_PATCH_MARKER) {
    throw new Error(`Patch must end with "${END_PATCH_MARKER}"`);
  }

  const operations: ApplyPatchOperation[] = [];
  let index = 1;
  while (index < lines.length - 1) {
    const line = lines[index] ?? "";
    if (line.length === 0) {
      index += 1;
      continue;
    }

    if (line.startsWith(ADD_FILE_MARKER)) {
      const filePath = line.slice(ADD_FILE_MARKER.length);
      if (!filePath) {
        throw new Error("Add File hunk is missing a path");
      }

      index += 1;
      const diffLines: string[] = [];
      while (index < lines.length - 1 && !isTopLevelPatchMarker(lines[index] ?? "")) {
        const diffLine = lines[index] ?? "";
        if (!diffLine.startsWith("+")) {
          throw new Error(`Invalid Add File Line: ${diffLine}`);
        }
        diffLines.push(diffLine);
        index += 1;
      }

      if (diffLines.length === 0) {
        throw new Error(`Add File hunk for \"${filePath}\" must contain at least one line`);
      }

      operations.push({
        type: "create_file",
        path: filePath,
        diff: diffLines.join("\n")
      });
      continue;
    }

    if (line.startsWith(DELETE_FILE_MARKER)) {
      const filePath = line.slice(DELETE_FILE_MARKER.length);
      if (!filePath) {
        throw new Error("Delete File hunk is missing a path");
      }

      operations.push({
        type: "delete_file",
        path: filePath
      });
      index += 1;
      continue;
    }

    if (line.startsWith(UPDATE_FILE_MARKER)) {
      const filePath = line.slice(UPDATE_FILE_MARKER.length);
      if (!filePath) {
        throw new Error("Update File hunk is missing a path");
      }

      index += 1;
      let moveTo: string | undefined;
      const maybeMoveLine = lines[index] ?? "";
      if (maybeMoveLine.startsWith(MOVE_TO_MARKER)) {
        moveTo = maybeMoveLine.slice(MOVE_TO_MARKER.length);
        if (!moveTo) {
          throw new Error(`Update File hunk for \"${filePath}\" is missing a move destination`);
        }
        index += 1;
      }

      const diffLines: string[] = [];
      while (index < lines.length - 1 && !isTopLevelPatchMarker(lines[index] ?? "")) {
        diffLines.push(lines[index] ?? "");
        index += 1;
      }

      operations.push({
        type: "update_file",
        path: filePath,
        diff: diffLines.join("\n"),
        ...(moveTo ? { move_to: moveTo } : {})
      });
      continue;
    }

    throw new Error(`Unexpected patch line: ${line}`);
  }

  if (operations.length === 0) {
    throw new Error("Patch must contain at least one hunk");
  }

  return operations;
}

function isTopLevelPatchMarker(line: string): boolean {
  return (
    line === END_PATCH_MARKER
    || line.startsWith(ADD_FILE_MARKER)
    || line.startsWith(DELETE_FILE_MARKER)
    || line.startsWith(UPDATE_FILE_MARKER)
  );
}

export function formatApplyPatchOperationSummary(operation: ApplyPatchOperation): string {
  switch (operation.type) {
    case "create_file":
      return `Create file ${operation.path}`;
    case "update_file":
      return operation.move_to
        ? `Update file ${operation.path} -> ${operation.move_to}`
        : `Update file ${operation.path}`;
    case "delete_file":
      return `Delete file ${operation.path}`;
  }
}

export async function applyPatchOperationToWorkspace(input: {
  operation: ApplyPatchOperation;
  baseDir: string;
  writableRoots: string[];
}): Promise<{ output: string; absolutePath: string }> {
  const requestedPath = path.isAbsolute(input.operation.path)
    ? path.resolve(input.operation.path)
    : path.resolve(input.baseDir, input.operation.path);
  const absolutePath = await resolveWritableFilePathWithinRoots(
    input.writableRoots,
    requestedPath
  );

  switch (input.operation.type) {
    case "create_file": {
      const existing = await fs.stat(absolutePath).catch(() => null);
      if (existing) {
        throw new Error(`File already exists at path \"${input.operation.path}\"`);
      }

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      const content = parseCreateFileDiff(input.operation.diff);
      await fs.writeFile(absolutePath, content, "utf8");
      return {
        output: `Created ${input.operation.path}`,
        absolutePath
      };
    }

    case "update_file": {
      const existing = await fs.stat(absolutePath).catch(() => null);
      if (!existing) {
        throw new Error(`File not found at path \"${input.operation.path}\"`);
      }
      if (!existing.isFile()) {
        throw new Error(`Path is not a file: \"${input.operation.path}\"`);
      }

      const current = await fs.readFile(absolutePath, "utf8");
      const next = input.operation.diff.trim().length > 0
        ? applyCodexStyleUpdateDiff(current, input.operation.diff)
        : current;

      const destinationPath = input.operation.move_to
        ? await resolveWritableFilePathWithinRoots(
            input.writableRoots,
            path.isAbsolute(input.operation.move_to)
              ? path.resolve(input.operation.move_to)
              : path.resolve(input.baseDir, input.operation.move_to)
          )
        : absolutePath;

      if (destinationPath !== absolutePath) {
        const destinationExisting = await fs.stat(destinationPath).catch(() => null);
        if (destinationExisting) {
          throw new Error(`File already exists at path \"${input.operation.move_to}\"`);
        }
      }

      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, next, "utf8");
      if (destinationPath !== absolutePath) {
        await fs.unlink(absolutePath);
      }

      return {
        output: input.operation.move_to
          ? `Updated ${input.operation.path} -> ${input.operation.move_to}`
          : `Updated ${input.operation.path}`,
        absolutePath: destinationPath
      };
    }

    case "delete_file": {
      const existing = await fs.stat(absolutePath).catch(() => null);
      if (!existing) {
        throw new Error(`File not found at path \"${input.operation.path}\"`);
      }
      if (!existing.isFile()) {
        throw new Error(`Path is not a file: \"${input.operation.path}\"`);
      }

      await fs.unlink(absolutePath);
      return {
        output: `Deleted ${input.operation.path}`,
        absolutePath
      };
    }
  }
}

function parseCreateFileDiff(diff: string): string {
  const lines = splitDiffLines(diff);
  let contents = "";

  for (const line of lines) {
    if (!line.startsWith("+")) {
      throw new Error(`Invalid Add File Line: ${line}`);
    }
    contents += `${line.slice(1)}\n`;
  }

  return contents;
}

export function applyCodexStyleUpdateDiff(input: string, diff: string): string {
  const chunks = parseCodexStyleUpdateFileChunks(diff);
  return applyUpdateFileChunks(input, chunks);
}

function parseCodexStyleUpdateFileChunks(diff: string): UpdateFileChunk[] {
  const lines = splitDiffLines(diff);
  if (lines.length === 0) {
    throw new Error("Update hunk does not contain any lines");
  }

  const chunks: UpdateFileChunk[] = [];
  let remainingLines = lines;
  let allowMissingContext = true;

  while (remainingLines.length > 0) {
    if (remainingLines[0]?.trim().length === 0) {
      remainingLines = remainingLines.slice(1);
      continue;
    }

    const { chunk, parsedLines } = parseUpdateFileChunk(remainingLines, allowMissingContext);
    chunks.push(chunk);
    remainingLines = remainingLines.slice(parsedLines);
    allowMissingContext = false;
  }

  return chunks;
}

function splitDiffLines(diff: string): string[] {
  const trimmed = diff.trim();
  if (trimmed.length === 0) {
    return [];
  }

  return trimmed.split(/\r?\n/).map((line) => line.replace(/\r$/, ""));
}

function parseUpdateFileChunk(
  lines: string[],
  allowMissingContext: boolean
): { chunk: UpdateFileChunk; parsedLines: number } {
  if (lines.length === 0) {
    throw new Error("Update hunk does not contain any lines");
  }

  let changeContext: string | null = null;
  let startIndex = 0;
  if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
    startIndex = 1;
  } else if (lines[0]?.startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = lines[0].slice(CHANGE_CONTEXT_MARKER.length);
    startIndex = 1;
  } else if (!allowMissingContext) {
    throw new Error(`Expected update hunk to start with a @@ context marker, got: ${lines[0]}`);
  }

  if (startIndex >= lines.length) {
    throw new Error("Update hunk does not contain any lines");
  }

  const chunk: UpdateFileChunk = {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false
  };

  let parsedLines = 0;
  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        throw new Error("Update hunk does not contain any lines");
      }
      chunk.isEndOfFile = true;
      parsedLines += 1;
      break;
    }

    if (line.length === 0) {
      chunk.oldLines.push("");
      chunk.newLines.push("");
      parsedLines += 1;
      continue;
    }

    const prefix = line[0];
    const contents = line.slice(1);
    if (prefix === " ") {
      chunk.oldLines.push(contents);
      chunk.newLines.push(contents);
    } else if (prefix === "+") {
      chunk.newLines.push(contents);
    } else if (prefix === "-") {
      chunk.oldLines.push(contents);
    } else if (parsedLines === 0) {
      throw new Error(
        `Unexpected line found in update hunk: ${line}. Every line should start with space, plus, or minus.`
      );
    } else {
      break;
    }

    parsedLines += 1;
  }

  return {
    chunk,
    parsedLines: parsedLines + startIndex
  };
}

function applyUpdateFileChunks(input: string, chunks: UpdateFileChunk[]): string {
  const originalLines = input.split("\n");
  if (originalLines.at(-1) === "") {
    originalLines.pop();
  }

  const replacements = computeReplacements(originalLines, chunks);
  const newLines = applyReplacements(originalLines, replacements);
  if (newLines.at(-1) !== "") {
    newLines.push("");
  }
  return newLines.join("\n");
}

function computeReplacements(
  originalLines: string[],
  chunks: UpdateFileChunk[]
): Array<{ startIndex: number; oldLength: number; newLines: string[] }> {
  const replacements: Array<{ startIndex: number; oldLength: number; newLines: string[] }> = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext !== null) {
      const contextIndex = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
      if (contextIndex === null) {
        throw new Error(`Failed to find context \"${chunk.changeContext}\"`);
      }
      lineIndex = contextIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex = originalLines.at(-1) === "" ? originalLines.length - 1 : originalLines.length;
      replacements.push({
        startIndex: insertionIndex,
        oldLength: 0,
        newLines: [...chunk.newLines]
      });
      continue;
    }

    let pattern = chunk.oldLines;
    let newLines = chunk.newLines;
    let foundIndex = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);

    if (foundIndex === null && pattern.at(-1) === "") {
      pattern = pattern.slice(0, -1);
      if (newLines.at(-1) === "") {
        newLines = newLines.slice(0, -1);
      }
      foundIndex = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    }

    if (foundIndex === null) {
      throw new Error(`Failed to find expected lines:\n${chunk.oldLines.join("\n")}`);
    }

    replacements.push({
      startIndex: foundIndex,
      oldLength: pattern.length,
      newLines: [...newLines]
    });
    lineIndex = foundIndex + pattern.length;
  }

  replacements.sort((left, right) => left.startIndex - right.startIndex);
  return replacements;
}

function applyReplacements(
  originalLines: string[],
  replacements: Array<{ startIndex: number; oldLength: number; newLines: string[] }>
): string[] {
  const lines = [...originalLines];

  for (const replacement of [...replacements].reverse()) {
    lines.splice(replacement.startIndex, replacement.oldLength, ...replacement.newLines);
  }

  return lines;
}

function seekSequence(lines: string[], pattern: string[], start: number, eof: boolean): number | null {
  if (pattern.length === 0) {
    return start;
  }
  if (pattern.length > lines.length) {
    return null;
  }

  const searchStart = eof && lines.length >= pattern.length
    ? lines.length - pattern.length
    : start;
  const maxIndex = lines.length - pattern.length;

  for (let index = searchStart; index <= maxIndex; index += 1) {
    if (slicesEqual(lines, pattern, index, (value) => value)) {
      return index;
    }
  }

  for (let index = searchStart; index <= maxIndex; index += 1) {
    if (slicesEqual(lines, pattern, index, (value) => value.trimEnd())) {
      return index;
    }
  }

  for (let index = searchStart; index <= maxIndex; index += 1) {
    if (slicesEqual(lines, pattern, index, (value) => value.trim())) {
      return index;
    }
  }

  for (let index = searchStart; index <= maxIndex; index += 1) {
    if (slicesEqual(lines, pattern, index, normalizeCodexText)) {
      return index;
    }
  }

  return null;
}

function slicesEqual(
  source: string[],
  target: string[],
  start: number,
  mapFn: (value: string) => string
): boolean {
  if (start + target.length > source.length) {
    return false;
  }

  for (let index = 0; index < target.length; index += 1) {
    if (mapFn(source[start + index]) !== mapFn(target[index])) {
      return false;
    }
  }

  return true;
}

function normalizeCodexText(value: string): string {
  return value
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, ASCII_APOSTROPHE)
    .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
    .replace(/[\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000]/g, " ");
}

async function resolveWritableFilePathWithinRoots(roots: string[], requestedPath: string): Promise<string> {
  const absoluteRequestedPath = path.resolve(requestedPath);
  const uniqueRoots = new Map<string, { absoluteRoot: string; realRoot: string }>();

  for (const root of roots) {
    const absoluteRoot = path.resolve(root);
    const realRoot = await fs.realpath(root).catch(() => null);
    if (!realRoot || uniqueRoots.has(realRoot)) {
      continue;
    }
    uniqueRoots.set(realRoot, {
      absoluteRoot,
      realRoot
    });
  }

  for (const root of uniqueRoots.values()) {
    const relativePath = resolveRelativePathWithinRoot(root, absoluteRequestedPath);
    if (!relativePath) {
      continue;
    }

    return resolveWritableFilePathWithinRoot(
      root.realRoot,
      path.join(root.realRoot, relativePath),
      requestedPath
    );
  }

  throw new Error(`Write operation denied outside allowed roots: ${requestedPath}`);
}

function resolveRelativePathWithinRoot(
  root: {
    absoluteRoot: string;
    realRoot: string;
  },
  absoluteRequestedPath: string
): string | null {
  if (isWithinPath(root.absoluteRoot, absoluteRequestedPath)) {
    return path.relative(root.absoluteRoot, absoluteRequestedPath);
  }

  if (isWithinPath(root.realRoot, absoluteRequestedPath)) {
    return path.relative(root.realRoot, absoluteRequestedPath);
  }

  return null;
}

async function resolveWritableFilePathWithinRoot(
  rootRealPath: string,
  absoluteRequestedPath: string,
  originalPath: string
): Promise<string> {
  if (!isWithinPath(rootRealPath, absoluteRequestedPath)) {
    throw new Error(`Write operation denied outside allowed roots: ${originalPath}`);
  }

  const relativePath = path.relative(rootRealPath, absoluteRequestedPath);
  if (!relativePath || relativePath === ".") {
    throw new Error(`Path must point to a file: ${originalPath}`);
  }

  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
  let currentPath = rootRealPath;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const nextPath = path.join(currentPath, segment);
    const stats = await fs.lstat(nextPath).catch(() => null);
    const isLeaf = index === segments.length - 1;

    if (!stats) {
      return path.join(currentPath, ...segments.slice(index));
    }

    if (stats.isSymbolicLink()) {
      throw new Error(`Path contains a symbolic link: ${originalPath}`);
    }

    if (isLeaf) {
      const realLeafPath = await fs.realpath(nextPath);
      if (!isWithinPath(rootRealPath, realLeafPath)) {
        throw new Error(`Path escapes allowed roots: ${originalPath}`);
      }
      return realLeafPath;
    }

    if (!stats.isDirectory()) {
      throw new Error(`Parent path is not a directory: ${originalPath}`);
    }

    currentPath = await fs.realpath(nextPath);
    if (!isWithinPath(rootRealPath, currentPath)) {
      throw new Error(`Path escapes allowed roots: ${originalPath}`);
    }
  }

  return absoluteRequestedPath;
}
