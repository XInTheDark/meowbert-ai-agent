// A status request can fail while the session's container is healthy (a slow docker exec under
// host load, a Docker API hiccup). Only a container Docker reports as stopped, or a supervisor that
// stays unreachable for this long, counts as lost.
export const STATUS_UNREACHABLE_GRACE_MS = 2 * 60_000;

const firstStatusFailureAt = new Map<string, number>();

export interface StatusFailure {
  firstFailure: boolean;
  unreachableMs: number;
}

export function noteStatusFailure(sessionId: string, nowMs = Date.now()): StatusFailure {
  const firstFailureAt = firstStatusFailureAt.get(sessionId);
  if (firstFailureAt === undefined) {
    firstStatusFailureAt.set(sessionId, nowMs);
    return { firstFailure: true, unreachableMs: 0 };
  }
  return { firstFailure: false, unreachableMs: nowMs - firstFailureAt };
}

export function forgetStatusFailures(sessionId: string): void {
  firstStatusFailureAt.delete(sessionId);
}
