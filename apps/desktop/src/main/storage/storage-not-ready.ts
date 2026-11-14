// Thrown when the run's storage is not reachable yet; the run returns to pending instead of failing.
export class StorageNotReadyError extends Error {}
