import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  buildBridgeHandoffPrompt,
  type BridgeHandoffInfo,
  type BridgeSessionStatus,
  type LocalExecutionMode
} from "@meowbert/shared";
import type { BridgeSession } from "./bridge-session.js";

export interface RegisteredBridgeEntry {
  runId: string;
  taskId: string;
  mode: LocalExecutionMode;
  sessionCode: string;
  createdAt: string;
  session: BridgeSession;
}

export class BridgeRegistry {
  private readonly byCode = new Map<string, RegisteredBridgeEntry>();
  private readonly byRunId = new Map<string, RegisteredBridgeEntry>();
  private readonly events = new EventEmitter();

  private generateSessionCode(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = `mb_${randomBytes(4).toString("hex")}`;
      if (!this.byCode.has(code)) return code;
    }
    return `mb_${randomBytes(8).toString("hex")}`;
  }

  toHandoffInfo(entry: RegisteredBridgeEntry): BridgeHandoffInfo {
    return {
      runId: entry.runId,
      taskId: entry.taskId,
      sessionCode: entry.sessionCode,
      mode: entry.mode,
      status: entry.session.getStatus(),
      prompt: buildBridgeHandoffPrompt(entry.sessionCode),
      createdAt: entry.createdAt,
      connectedAt: entry.session.connectedAt,
      lastActivityAt: entry.session.lastActivityAt
    };
  }

  register(input: {
    runId: string;
    taskId: string;
    mode: LocalExecutionMode;
    session: BridgeSession;
  }): BridgeHandoffInfo {
    const existing = this.byRunId.get(input.runId);
    if (existing) {
      this.unregister(input.runId);
    }
    const entry: RegisteredBridgeEntry = {
      runId: input.runId,
      taskId: input.taskId,
      mode: input.mode,
      sessionCode: this.generateSessionCode(),
      createdAt: new Date().toISOString(),
      session: input.session
    };
    this.byCode.set(entry.sessionCode, entry);
    this.byRunId.set(entry.runId, entry);
    this.notifyChanged();
    return this.toHandoffInfo(entry);
  }

  notifyStatusChanged(_runId: string, _status: BridgeSessionStatus): void {
    this.notifyChanged();
  }

  unregister(runId: string): void {
    const entry = this.byRunId.get(runId);
    if (!entry) return;
    this.byRunId.delete(runId);
    this.byCode.delete(entry.sessionCode);
    this.notifyChanged();
  }

  getByCode(code: string): RegisteredBridgeEntry | null {
    return this.byCode.get(code.trim()) ?? null;
  }

  getByRunId(runId: string): RegisteredBridgeEntry | null {
    return this.byRunId.get(runId) ?? null;
  }

  getByTaskId(taskId: string): BridgeHandoffInfo | null {
    for (const entry of this.byRunId.values()) {
      if (entry.taskId === taskId) {
        return this.toHandoffInfo(entry);
      }
    }
    return null;
  }

  listActive(): BridgeHandoffInfo[] {
    return [...this.byRunId.values()].map((entry) => this.toHandoffInfo(entry));
  }

  parkRun(runId: string, reason = "Bridge session was disconnected by the user. Send a follow-up message to continue."): boolean {
    const entry = this.byRunId.get(runId);
    if (!entry) return false;
    entry.session.park(reason);
    this.notifyChanged();
    return true;
  }

  onChange(listener: (sessions: BridgeHandoffInfo[]) => void): () => void {
    this.events.on("change", listener);
    return () => {
      this.events.off("change", listener);
    };
  }

  private notifyChanged(): void {
    this.events.emit("change", this.listActive());
  }
}
