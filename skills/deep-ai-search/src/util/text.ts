import { clamp } from './numbers.js';

export interface TextChunk {
  index: number;
  text: string;
}

export function truncateToChars(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function chunkTextByChars(text: string, chunkSizeChars: number, overlapChars: number): TextChunk[] {
  const size = Math.max(1, Math.floor(chunkSizeChars));
  const overlap = clamp(Math.floor(overlapChars), 0, size - 1);

  const chunks: TextChunk[] = [];
  let index = 0;
  for (let start = 0; start < text.length; start += size - overlap) {
    const end = Math.min(text.length, start + size);
    chunks.push({ index, text: text.slice(start, end) });
    index += 1;
    if (end >= text.length) break;
  }
  return chunks;
}

export function approxCharBudgetFromDepth(depth: number): number {
  // Depth is a 0-10 "log-ish" knob. This mapping aims to make depth 10 "big but not insane".
  // 0  -> ~5k chars
  // 5  -> ~31k chars
  // 10 -> ~200k chars
  const base = 5000;
  const factor = 1.446;
  return Math.round(base * Math.pow(factor, depth));
}
