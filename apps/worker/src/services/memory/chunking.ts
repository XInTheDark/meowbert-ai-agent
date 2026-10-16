import path from "node:path";
import { MEMORY_CHUNK_OVERLAP, MEMORY_CHUNK_SIZE } from "./shared.js";

export interface MemoryTextChunk {
  start: number;
  end: number;
  text: string;
  headingPath: string[];
}

export interface ChunkedMemoryFile {
  normalizedText: string;
  description: string | null;
  chunks: MemoryTextChunk[];
}

interface Span {
  start: number;
  end: number;
}

interface Line extends Span {
  text: string;
}

interface Section extends Span {
  headingPath: string[];
}

const STRUCTURED_EXTENSIONS = new Set(["", ".md", ".markdown", ".mdx", ".txt"]);
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_PATTERN = /^\s*(```|~~~)/;
const TOP_LEVEL_LIST_ITEM_PATTERN = /^([-*+]|\d+[.)])\s/;
const MAX_DESCRIPTION_CHARS = 300;

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline + 1;
    lines.push({ start, end, text: text.slice(start, newline === -1 ? end : newline) });
    start = end;
  }
  return lines;
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").trim();
}

function parseFrontmatter(lines: Line[]): { bodyLineIndex: number; description: string | null } {
  if (lines[0]?.text.trim() !== "---") {
    return { bodyLineIndex: 0, description: null };
  }
  let description: string | null = null;
  for (let index = 1; index < lines.length; index += 1) {
    const text = lines[index].text;
    if (text.trim() === "---" || text.trim() === "...") {
      return { bodyLineIndex: index + 1, description };
    }
    const match = /^description:\s*(.+)$/.exec(text);
    if (match) {
      description = unquote(match[1]) || null;
    }
  }
  return { bodyLineIndex: 0, description: null };
}

// A short prose line right after the optional title counts as the file's description.
function findLeadingDescription(lines: Line[], bodyLineIndex: number): string | null {
  let index = bodyLineIndex;
  const nextNonBlank = () => {
    while (index < lines.length && lines[index].text.trim() === "") {
      index += 1;
    }
    return lines[index]?.text.trim() ?? null;
  };
  let candidate = nextNonBlank();
  if (candidate && /^#\s/.test(candidate)) {
    index += 1;
    candidate = nextNonBlank();
  }
  if (!candidate || candidate.length > MAX_DESCRIPTION_CHARS || /^(#|[-*+>|]|\d+[.)]\s|```|~~~)/.test(candidate)) {
    return null;
  }
  return candidate;
}

function parseSections(lines: Line[], bodyLineIndex: number, textLength: number): Section[] {
  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let current: Section = { start: lines[bodyLineIndex]?.start ?? textLength, end: textLength, headingPath: [] };
  let inFence = false;

  for (const line of lines.slice(bodyLineIndex)) {
    if (FENCE_PATTERN.test(line.text)) {
      inFence = !inFence;
      continue;
    }
    const heading = inFence ? null : HEADING_PATTERN.exec(line.text);
    if (!heading) {
      continue;
    }
    sections.push({ ...current, end: line.start });
    const level = heading[1].length;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack.push({ level, title: heading[2] });
    current = { start: line.start, end: textLength, headingPath: stack.map((entry) => entry.title) };
  }
  sections.push(current);
  return sections;
}

function commonPrefix(left: string[], right: string[]): string[] {
  const prefix: string[] = [];
  for (let index = 0; index < Math.min(left.length, right.length) && left[index] === right[index]; index += 1) {
    prefix.push(left[index]);
  }
  return prefix;
}

// Merges small neighbouring sections when the next one is a child or sibling of what is
// already in the chunk, so a chunk never spans unrelated parts of the file.
function mergeSmallSections(sections: Section[], chunkSize: number): Section[] {
  const merged: Section[] = [];
  for (const section of sections) {
    const previous = merged[merged.length - 1];
    const fits = previous && section.end - previous.start <= chunkSize;
    const shared = previous ? commonPrefix(previous.headingPath, section.headingPath) : [];
    if (previous && fits && shared.length >= section.headingPath.length - 1) {
      merged[merged.length - 1] = { start: previous.start, end: section.end, headingPath: shared };
      continue;
    }
    merged.push(section);
  }
  return merged;
}

function splitBySize(text: string, span: Span, chunkSize: number, overlap: number): Span[] {
  const spans: Span[] = [];
  let start = span.start;
  while (start < span.end) {
    let end = Math.min(span.end, start + chunkSize);
    if (end < span.end) {
      const minimumEnd = start + Math.floor(chunkSize / 2);
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      const lineBreak = text.lastIndexOf("\n", end);
      if (paragraphBreak > minimumEnd) {
        end = paragraphBreak + 2;
      } else if (lineBreak > minimumEnd) {
        end = lineBreak + 1;
      }
    }
    spans.push({ start, end });
    if (end >= span.end) {
      break;
    }
    start = Math.max(start + 1, end - overlap);
  }
  return spans;
}

// Splits a section into blocks at blank lines and top-level list items, keeping fenced
// code intact, so a block is a paragraph, a whole bullet with its sub-bullets, or a code block.
function splitIntoBlocks(lines: Line[], span: Span): Span[] {
  const blocks: Span[] = [];
  let blockStart: number | null = null;
  let inFence = false;

  for (const line of lines) {
    if (line.end <= span.start || line.start >= span.end) {
      continue;
    }
    const isFence = FENCE_PATTERN.test(line.text);
    const blank = !inFence && line.text.trim() === "";
    const startsItem = !inFence && TOP_LEVEL_LIST_ITEM_PATTERN.test(line.text);
    if (blockStart !== null && (blank || startsItem)) {
      blocks.push({ start: blockStart, end: line.start });
      blockStart = null;
    }
    if (!blank && blockStart === null) {
      blockStart = line.start;
    }
    if (isFence) {
      inFence = !inFence;
    }
  }
  if (blockStart !== null) {
    blocks.push({ start: blockStart, end: span.end });
  }
  return blocks;
}

function packBlocks(text: string, blocks: Span[], chunkSize: number, overlap: number): Span[] {
  const spans: Span[] = [];
  let currentStart = -1;
  let currentEnd = -1;

  blocks.forEach((block, index) => {
    if (block.end - block.start > chunkSize) {
      if (currentStart >= 0) {
        spans.push({ start: currentStart, end: currentEnd });
      }
      spans.push(...splitBySize(text, block, chunkSize, overlap));
      currentStart = -1;
      return;
    }
    if (currentStart >= 0 && block.end - currentStart > chunkSize) {
      spans.push({ start: currentStart, end: currentEnd });
      const previous = blocks[index - 1];
      const carry = previous.end - previous.start <= overlap && previous.start > currentStart;
      currentStart = carry ? previous.start : block.start;
    } else if (currentStart < 0) {
      currentStart = block.start;
    }
    currentEnd = block.end;
  });
  if (currentStart >= 0) {
    spans.push({ start: currentStart, end: currentEnd });
  }
  return spans;
}

function toChunks(text: string, spans: Span[], headingPath: string[]): MemoryTextChunk[] {
  return spans
    .map((span) => ({ ...span, text: text.slice(span.start, span.end).trim(), headingPath }))
    .filter((chunk) => chunk.text.length > 0);
}

export function chunkMemoryFile(
  relativePath: string,
  rawText: string,
  chunkSize = MEMORY_CHUNK_SIZE,
  overlap = MEMORY_CHUNK_OVERLAP
): ChunkedMemoryFile {
  const text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!STRUCTURED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    const spans = splitBySize(text, { start: 0, end: text.length }, chunkSize, overlap);
    return { normalizedText: text, description: null, chunks: toChunks(text, spans, []) };
  }

  const lines = splitLines(text);
  const frontmatter = parseFrontmatter(lines);
  const description = frontmatter.description ?? findLeadingDescription(lines, frontmatter.bodyLineIndex);
  const sections = mergeSmallSections(
    parseSections(lines, frontmatter.bodyLineIndex, text.length)
      .filter((section) => text.slice(section.start, section.end).trim().length > 0),
    chunkSize
  );
  const chunks = sections.flatMap((section) => {
    const spans = section.end - section.start <= chunkSize
      ? [section]
      : packBlocks(text, splitIntoBlocks(lines, section), chunkSize, overlap);
    return toChunks(text, spans, section.headingPath);
  });
  return { normalizedText: text, description, chunks };
}

export function buildChunkContext(input: {
  relativePath: string;
  headingPath: string[];
  description: string | null;
}): string {
  const breadcrumb = [input.relativePath, ...input.headingPath].join(" › ");
  return input.description ? `${breadcrumb}\n${input.description}` : breadcrumb;
}
