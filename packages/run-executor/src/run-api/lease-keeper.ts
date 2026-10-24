import { RUN_LEASE_HEARTBEAT_INTERVAL_MS, RUN_LEASE_SELF_FENCE_AFTER_MS } from "@meowbert/shared";
import type { RunCancellationReason, RunCancellationState } from "../agent/ports/run-control.js";
import { RunApiError, type RunApiClient } from "./client.js";

export interface RunLeaseKeeperOptions {
  heartbeatIntervalMs?: number;
  selfFenceAfterMs?: number;
  cancellationPollMs?: number;
  // Called once when the executor stops working on the run because its lease is gone.
  onFenced?: () => void;
}

export interface RunLeaseKeeper {
  start(): void;
  stop(): void;
  watch(watcher: (reason: RunCancellationReason) => void): () => void;
}

// Keeps a remote executor's lease on a run: heartbeats renew it, and when renewal keeps failing
// the executor fences itself (stops the run) well before the server would hand the run to anyone
// else. Cancellation is polled, since there is no push channel to the executor.
export function createRunLeaseKeeper(client: RunApiClient, options: RunLeaseKeeperOptions = {}): RunLeaseKeeper {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? RUN_LEASE_HEARTBEAT_INTERVAL_MS;
  const selfFenceAfterMs = options.selfFenceAfterMs ?? RUN_LEASE_SELF_FENCE_AFTER_MS;
  const cancellationPollMs = options.cancellationPollMs ?? 2_000;
  const watchers = new Set<(reason: RunCancellationReason) => void>();
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let watchdogTimer: NodeJS.Timeout | null = null;
  let heartbeatInFlight = false;
  let lastRenewedAt = Date.now();
  let fenced = false;

  function notify(reason: RunCancellationReason): void {
    for (const watcher of [...watchers]) watcher(reason);
  }

  function stop(): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = null;
    heartbeatTimer = null;
    pollTimer = null;
  }

  // Another holder may own the run now, which the cancellation monitor treats like a newer attempt.
  function fence(): void {
    if (fenced) return;
    fenced = true;
    stop();
    options.onFenced?.();
    notify("newer_attempt");
  }

  async function heartbeat(): Promise<void> {
    if (heartbeatInFlight || fenced) return;
    heartbeatInFlight = true;
    try {
      await client.call("control.heartbeat", []);
      lastRenewedAt = Date.now();
    } catch (error) {
      if (error instanceof RunApiError && error.code === "lease_lost") {
        fence();
        return;
      }
      if (Date.now() - lastRenewedAt >= selfFenceAfterMs) fence();
    } finally {
      heartbeatInFlight = false;
    }
  }

  async function pollCancellation(): Promise<void> {
    const state = await client.call("control.readCancellation", []).catch(() => null) as RunCancellationState | null;
    if (!state) return;
    if (state.cancelRequested) notify("explicit_cancel");
    else if (!state.latestAttempt) notify("newer_attempt");
  }

  return {
    stop,
    start() {
      if (heartbeatTimer || fenced) return;
      lastRenewedAt = Date.now();
      heartbeatTimer = setInterval(() => void heartbeat(), heartbeatIntervalMs);
      heartbeatTimer.unref?.();
      watchdogTimer = setInterval(() => {
        if (Date.now() - lastRenewedAt >= selfFenceAfterMs) fence();
      }, Math.min(1_000, heartbeatIntervalMs));
      watchdogTimer.unref?.();
    },
    watch(watcher) {
      watchers.add(watcher);
      if (!pollTimer && !fenced) {
        pollTimer = setInterval(() => void pollCancellation(), cancellationPollMs);
        pollTimer.unref?.();
      }
      if (fenced) watcher("newer_attempt");
      return () => {
        watchers.delete(watcher);
        if (watchers.size === 0 && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
    }
  };
}
