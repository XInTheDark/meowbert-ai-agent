import pLimit from 'p-limit';

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) throw new Error(`chunkSize must be > 0, got ${chunkSize}`);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = pLimit(concurrency);
  return await Promise.all(items.map((item, i) => limit(() => fn(item, i))));
}

