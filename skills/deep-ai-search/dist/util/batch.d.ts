export declare function chunkArray<T>(items: T[], chunkSize: number): T[][];
export declare function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>;
