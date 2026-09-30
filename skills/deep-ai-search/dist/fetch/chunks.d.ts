import * as z from 'zod/v4';
export type ChunkSelection = number | {
    start: number;
    end: number;
};
export declare const ChunkSelectionSchema: z.ZodType<ChunkSelection>;
export declare function normalizeChunkSelection(selection: ChunkSelection[], chunkCount: number): number[];
