import * as z from 'zod/v4';

import { clamp } from '../util/numbers.js';

export type ChunkSelection = number | { start: number; end: number };

export const ChunkSelectionSchema: z.ZodType<ChunkSelection> = z.union([
  z.coerce.number().int().min(0),
  z.object({
    start: z.coerce.number().int().min(0),
    end: z.coerce.number().int().min(0)
  })
]);

export function normalizeChunkSelection(selection: ChunkSelection[], chunkCount: number): number[] {
  const out: number[] = [];
  for (const item of selection) {
    if (typeof item === 'number') {
      if (item >= 0 && item < chunkCount) out.push(item);
      continue;
    }
    const start = clamp(item.start, 0, chunkCount - 1);
    const end = clamp(item.end, 0, chunkCount - 1);
    for (let i = Math.min(start, end); i <= Math.max(start, end); i += 1) {
      out.push(i);
    }
  }
  const seen = new Set<number>();
  const unique = out.filter(i => (seen.has(i) ? false : (seen.add(i), true)));
  unique.sort((a, b) => a - b);
  return unique;
}
