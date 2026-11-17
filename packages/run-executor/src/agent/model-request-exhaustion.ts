// Keep the original error (including provider retry hints) when retries give up.
const exhaustedRequests = new WeakSet<Error>();

export function exhaustedModelRequest(error: Error): Error {
  exhaustedRequests.add(error);
  return error;
}

export function isExhaustedModelRequest(error: unknown): boolean {
  return error instanceof Error && exhaustedRequests.has(error);
}
