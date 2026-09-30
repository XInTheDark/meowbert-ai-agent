import pLimit from 'p-limit';
export function chunkArray(items, chunkSize) {
    if (chunkSize <= 0)
        throw new Error(`chunkSize must be > 0, got ${chunkSize}`);
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
}
export async function mapConcurrent(items, concurrency, fn) {
    const limit = pLimit(concurrency);
    return await Promise.all(items.map((item, i) => limit(() => fn(item, i))));
}
//# sourceMappingURL=batch.js.map