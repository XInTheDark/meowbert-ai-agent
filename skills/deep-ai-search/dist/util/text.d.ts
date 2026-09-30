export interface TextChunk {
    index: number;
    text: string;
}
export declare function truncateToChars(text: string, maxChars: number): string;
export declare function chunkTextByChars(text: string, chunkSizeChars: number, overlapChars: number): TextChunk[];
export declare function approxCharBudgetFromDepth(depth: number): number;
