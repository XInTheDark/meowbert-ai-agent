import { randomUUID } from "node:crypto";
import type { Response } from "openai/resources/responses/responses";
import {
  BRIDGE_CONNECT_TIMEOUT_MS,
  BRIDGE_IDLE_TIMEOUT_MS,
  type BridgeSessionStatus
} from "@meowbert/shared";
import {
  buildSyntheticBridgeResponse,
  extractInitialPromptBundle,
  extractToolResultsFromRequestDelta,
  normalizeBridgeTools,
  type BridgeMcpToolDefinition,
  type BridgeMcpToolResult
} from "./bridge-mcp-translation.js";

export class BridgeSessionError extends Error {
  constructor(
    readonly code: "bridge_parked" | "bridge_cancelled",
    message: string
  ) {
    super(message);
    this.name = "BridgeSessionError";
  }
}

interface QueuedToolCall {
  callId: string;
  name: string;
  argumentsJson: string;
  resolve: (result: BridgeMcpToolResult) => void;
}

interface PendingTurnWaiter {
  resolve: (calls: QueuedToolCall[]) => void;
  reject: (error: Error) => void;
}

export interface BridgeSessionOptions {
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  coalesceWindowMs?: number;
  onStatusChange?: (status: BridgeSessionStatus, detail?: { message?: string }) => void;
}

const DEFAULT_COALESCE_WINDOW_MS = 15;
const START_BOOTSTRAP_WAIT_MS = 30_000;

function errorToolResult(text: string): BridgeMcpToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

export class BridgeSession {
  private status: BridgeSessionStatus = "waiting_for_start";
  private latestRequestBody: Record<string, unknown> | null = null;
  private lastInputLength = 0;
  private pendingInFlightCalls = new Map<string, QueuedToolCall>();
  private queuedIncomingCalls: QueuedToolCall[] = [];
  private turnWaiter: PendingTurnWaiter | null = null;
  private startBodyWaiters: Array<{ resolve: (body: Record<string, unknown>) => void; reject: (err: Error) => void }> = [];
  private activeTimer: NodeJS.Timeout | null = null;
  private coalesceTimer: NodeJS.Timeout | null = null;
  private closedReason: string | null = null;
  private readonly connectTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly coalesceWindowMs: number;
  private readonly onStatusChange?: BridgeSessionOptions["onStatusChange"];
  connectedAt: string | null = null;
  lastActivityAt: string | null = null;

  constructor(options: BridgeSessionOptions = {}) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? BRIDGE_CONNECT_TIMEOUT_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? BRIDGE_IDLE_TIMEOUT_MS;
    this.coalesceWindowMs = options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
    this.onStatusChange = options.onStatusChange;
  }

  getStatus(): BridgeSessionStatus {
    return this.status;
  }

  private setStatus(next: BridgeSessionStatus, message?: string): void {
    if (this.status === next) return;
    this.status = next;
    this.onStatusChange?.(next, message ? { message } : undefined);
  }

  private clearTimers(): void {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
  }

  private isClosed(): boolean {
    return this.status === "completed" || this.status === "parked" || this.status === "cancelled";
  }

  private flushQueuedCallsToWaiter(): void {
    if (!this.turnWaiter || this.queuedIncomingCalls.length === 0) return;
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    const waiter = this.turnWaiter;
    this.turnWaiter = null;
    const batch = this.queuedIncomingCalls.splice(0, this.queuedIncomingCalls.length);
    waiter.resolve(batch);
  }

  private scheduleTurnFlush(): void {
    if (!this.turnWaiter || this.queuedIncomingCalls.length === 0) return;
    if (this.coalesceWindowMs <= 0) {
      this.flushQueuedCallsToWaiter();
      return;
    }
    if (this.coalesceTimer) return;
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = null;
      this.flushQueuedCallsToWaiter();
    }, this.coalesceWindowMs);
  }

  private resolveInFlightFromRequest(body: Record<string, unknown>): void {
    if (this.pendingInFlightCalls.size === 0) return;
    const inputItems = Array.isArray(body.input) ? body.input : [];
    const callIds = [...this.pendingInFlightCalls.keys()];
    const results = extractToolResultsFromRequestDelta(inputItems, this.lastInputLength, callIds);
    for (const [callId, call] of this.pendingInFlightCalls.entries()) {
      const result = results.get(callId) ?? { content: [{ type: "text", text: "Tool completed." }] };
      call.resolve(result);
    }
    this.pendingInFlightCalls.clear();
  }

  private waitForNextBatch(signal?: AbortSignal): Promise<QueuedToolCall[]> {
    if (this.isClosed()) {
      const err = this.status === "cancelled"
        ? new Error("TASK_CANCELLED")
        : new BridgeSessionError("bridge_parked", this.closedReason ?? "Bridge session ended.");
      return Promise.reject(err);
    }
    if (this.queuedIncomingCalls.length > 0) {
      return Promise.resolve(this.queuedIncomingCalls.splice(0, this.queuedIncomingCalls.length));
    }

    return new Promise<QueuedToolCall[]>((resolve, reject) => {
      const cleanup = () => {
        this.clearTimers();
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (this.turnWaiter) this.turnWaiter = null;
        cleanup();
        reject(new Error("TASK_CANCELLED"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      const timeoutMs = this.status === "connected" ? this.idleTimeoutMs : this.connectTimeoutMs;
      this.activeTimer = setTimeout(() => {
        if (this.turnWaiter) this.turnWaiter = null;
        cleanup();
        const reason = this.status === "connected"
          ? "Bridge session paused after inactivity without a final response. Send a follow-up message to continue."
          : "Bridge session timed out waiting for an external harness to connect. Send a follow-up message to retry.";
        this.park(reason);
        reject(new BridgeSessionError("bridge_parked", reason));
      }, timeoutMs);

      this.turnWaiter = {
        resolve: (calls) => { cleanup(); resolve(calls); },
        reject: (err) => { cleanup(); reject(err); }
      };
    });
  }

  async handleModelTurn(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    this.resolveInFlightFromRequest(body);
    this.latestRequestBody = body;
    this.lastInputLength = Array.isArray(body.input) ? body.input.length : 0;

    if (this.startBodyWaiters.length > 0) {
      const waiters = this.startBodyWaiters.splice(0, this.startBodyWaiters.length);
      for (const waiter of waiters) waiter.resolve(body);
    }

    const batch = await this.waitForNextBatch(signal);
    for (const call of batch) {
      this.pendingInFlightCalls.set(call.callId, call);
    }
    return buildSyntheticBridgeResponse(`bridge_resp_${randomUUID()}`, batch);
  }

  private waitForInitialRequestBody(): Promise<Record<string, unknown>> {
    if (this.latestRequestBody) return Promise.resolve(this.latestRequestBody);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.startBodyWaiters = this.startBodyWaiters.filter((entry) => entry.resolve !== onResolve);
        reject(new Error("Meowbert run is still initializing; retry meowbert_start in a moment."));
      }, START_BOOTSTRAP_WAIT_MS);
      const onResolve = (body: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(body);
      };
      const onReject = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      this.startBodyWaiters.push({ resolve: onResolve, reject: onReject });
    });
  }

  async claimStart(): Promise<BridgeMcpToolResult> {
    if (this.status === "cancelled") {
      return errorToolResult("RUN_CANCELLED: This Meowbert run was cancelled.");
    }
    if (this.status === "completed" || this.status === "parked") {
      return errorToolResult(this.closedReason ?? "This Meowbert bridge session is no longer active.");
    }
    let body: Record<string, unknown>;
    try {
      body = await this.waitForInitialRequestBody();
    } catch (error) {
      return errorToolResult(error instanceof Error ? error.message : String(error));
    }
    const now = new Date().toISOString();
    this.lastActivityAt = now;
    if (this.status === "waiting_for_start") {
      this.connectedAt = now;
      this.setStatus("connected");
      if (this.turnWaiter) {
        if (this.activeTimer) clearTimeout(this.activeTimer);
        this.activeTimer = setTimeout(() => {
          const reason = "Bridge session paused after inactivity without a final response. Send a follow-up message to continue.";
          this.park(reason);
        }, this.idleTimeoutMs);
      }
    }
    return extractInitialPromptBundle(body);
  }

  listAvailableTools(): BridgeMcpToolDefinition[] {
    if (!this.latestRequestBody) return [];
    return normalizeBridgeTools(this.latestRequestBody.tools);
  }

  invokeTool(name: string, args: Record<string, unknown>): Promise<BridgeMcpToolResult> {
    if (this.status === "cancelled") {
      return Promise.resolve(errorToolResult("RUN_CANCELLED: Stop working immediately."));
    }
    if (this.status === "completed" || this.status === "parked") {
      return Promise.resolve(errorToolResult(this.closedReason ?? "This Meowbert bridge session has ended. Stop here."));
    }
    if (this.status === "waiting_for_start") {
      return Promise.resolve(errorToolResult("Call `meowbert_start` with this session_code before invoking Meowbert tools."));
    }
    this.lastActivityAt = new Date().toISOString();
    const callId = `bridge_call_${randomUUID()}`;
    const argumentsJson = JSON.stringify(args ?? {});
    return new Promise<BridgeMcpToolResult>((resolve) => {
      this.queuedIncomingCalls.push({ callId, name, argumentsJson, resolve });
      this.scheduleTurnFlush();
    });
  }

  private resolveAllPendingCalls(result: BridgeMcpToolResult): void {
    for (const call of this.pendingInFlightCalls.values()) call.resolve(result);
    this.pendingInFlightCalls.clear();
    for (const call of this.queuedIncomingCalls.splice(0, this.queuedIncomingCalls.length)) call.resolve(result);
  }

  park(reason: string): void {
    if (this.isClosed()) return;
    this.closedReason = reason;
    this.clearTimers();
    this.setStatus("parked", reason);
    const err = new BridgeSessionError("bridge_parked", reason);
    if (this.turnWaiter) {
      const waiter = this.turnWaiter;
      this.turnWaiter = null;
      waiter.reject(err);
    }
    for (const waiter of this.startBodyWaiters.splice(0, this.startBodyWaiters.length)) waiter.reject(err);
    this.resolveAllPendingCalls(errorToolResult(reason));
  }

  cancel(reason = "RUN_CANCELLED: Stop working immediately."): void {
    if (this.isClosed()) return;
    this.closedReason = reason;
    this.clearTimers();
    this.setStatus("cancelled", reason);
    const err = new Error("TASK_CANCELLED");
    if (this.turnWaiter) {
      const waiter = this.turnWaiter;
      this.turnWaiter = null;
      waiter.reject(err);
    }
    for (const waiter of this.startBodyWaiters.splice(0, this.startBodyWaiters.length)) waiter.reject(err);
    this.resolveAllPendingCalls(errorToolResult(reason));
  }

  onRunEnded(outcome: { status: "completed" | "parked" | "failed" | "cancelled"; message?: string }): void {
    this.clearTimers();
    if (outcome.status === "cancelled") {
      this.cancel(outcome.message);
      return;
    }
    if (outcome.status === "parked") {
      this.park(outcome.message ?? "Bridge session paused.");
      return;
    }
    const finalMessage = outcome.message ?? (outcome.status === "completed"
      ? "Meowbert run finalized. You may stop here."
      : "Meowbert run ended with an error.");
    if (!this.isClosed()) {
      this.closedReason = finalMessage;
      this.setStatus("completed", finalMessage);
    }
    this.resolveAllPendingCalls({
      isError: outcome.status === "failed",
      content: [{ type: "text", text: finalMessage }]
    });
  }
}
