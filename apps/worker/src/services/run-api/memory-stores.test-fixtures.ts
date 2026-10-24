import type { OperationBegin, RunApiStores, StoredOperationResponse } from "./stores.js";

// The Run API stores with the database's semantics, in memory.
export function createMemoryRunApiStores(options: { headroomByUser?: Record<string, number> } = {}) {
  // message id -> parent id, for messages appended outside the Run API.
  const messageParents = new Map<string, string | null>();
  const leases = new Map<string, { epoch: number; live: boolean }>();
  const operations = new Map<string, { requestHash: string; response: StoredOperationResponse | null }>();
  const reservations = new Map<string, { userId: string; weightedTokens: number }>();
  let nextReservation = 0;

  const stores: RunApiStores = {
    leases: {
      async releaseForStorage({ runId, epoch }) {
        const lease = leases.get(runId);
        if (lease?.epoch !== epoch || !lease.live) return false;
        lease.live = false;
        return true;
      },
      async claim({ runId }) {
        const epoch = (leases.get(runId)?.epoch ?? 0) + 1;
        leases.set(runId, { epoch, live: true });
        return { epoch };
      },
      async renew({ runId, epoch }) {
        const lease = leases.get(runId);
        return lease?.epoch === epoch && lease.live;
      },
      async currentEpoch(runId) {
        return leases.get(runId)?.epoch ?? null;
      },
      async release({ runId, epoch }) {
        const lease = leases.get(runId);
        if (lease?.epoch === epoch) lease.live = false;
      }
    },
    operations: {
      async begin({ runId, operationId, requestHash }): Promise<OperationBegin> {
        const key = `${runId}:${operationId}`;
        const existing = operations.get(key);
        if (!existing) {
          operations.set(key, { requestHash, response: null });
          return { state: "new" };
        }
        if (existing.requestHash !== requestHash) return { state: "conflict" };
        return existing.response ? { state: "done", response: existing.response } : { state: "pending" };
      },
      async finish({ runId, operationId, response }) {
        const entry = operations.get(`${runId}:${operationId}`);
        if (entry) entry.response = response;
      }
    },
    // No await between the balance check and the insert: like the row lock, nothing interleaves.
    reservations: {
      async reserve({ userId, weightedTokens }) {
        const headroom = options.headroomByUser?.[userId];
        if (headroom !== undefined) {
          const held = [...reservations.values()].filter((entry) => entry.userId === userId).reduce((sum, entry) => sum + entry.weightedTokens, 0);
          if (held + weightedTokens > headroom) return null;
        }
        const id = `reservation-${++nextReservation}`;
        reservations.set(id, { userId, weightedTokens });
        return { id };
      },
      async release(id) {
        reservations.delete(id);
      }
    },
    messages: {
      async isAncestor({ ancestorId, messageId }) {
        let current: string | null | undefined = messageId;
        while (current !== undefined) {
          if (current === ancestorId) return true;
          if (current === null) return false;
          current = messageParents.get(current);
        }
        return false;
      }
    }
  };
  return { stores, leases, operations, reservations, messageParents };
}
