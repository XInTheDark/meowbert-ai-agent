// What the Run API keeps in the database, behind interfaces so its semantics can be tested
// without one.

export interface RunLeaseStore {
  // Takes the run's lease for a new epoch; null when the run is not admitted or already finished.
  claim(input: { runId: string; holder: string; apiUrl: string; ttlMs: number }): Promise<{ epoch: number } | null>;
  // Extends the lease; false when the epoch is no longer current.
  renew(input: { runId: string; epoch: number; ttlMs: number }): Promise<boolean>;
  currentEpoch(runId: string): Promise<number | null>;
  release(input: { runId: string; epoch: number }): Promise<void>;
  releaseForStorage(input: { runId: string; epoch: number }): Promise<boolean>;
}

export type OperationBegin =
  | { state: "new" }
  | { state: "done"; response: StoredOperationResponse }
  // Started by an earlier attempt that never recorded its result.
  | { state: "pending" }
  // The id was used for a different request.
  | { state: "conflict" };

export type StoredOperationResponse =
  | { ok: true; result: unknown }
  | { ok: false; status: number; error: { code: string; message: string; currentLeafId?: string | null } };

export interface RunOperationStore {
  begin(input: { runId: string; operationId: string; requestHash: string }): Promise<OperationBegin>;
  finish(input: { runId: string; operationId: string; response: StoredOperationResponse }): Promise<void>;
}

export interface UsageReservationStore {
  // Holds the request's maximum cost against the user's monthly allowance, under a lock on the
  // user, so concurrent requests cannot all pass the same balance check. Null when it does not fit.
  reserve(input: { userId: string; runId: string; weightedTokens: number }): Promise<{ id: string } | null>;
  release(reservationId: string): Promise<void>;
}

export interface RunMessageStore {
  // True when `ancestorId` is on the branch that ends at `messageId`, within a bounded depth.
  isAncestor(input: { taskId: string; ancestorId: string | null; messageId: string }): Promise<boolean>;
}

export interface RunApiStores {
  leases: RunLeaseStore;
  operations: RunOperationStore;
  reservations: UsageReservationStore;
  messages: RunMessageStore;
}
