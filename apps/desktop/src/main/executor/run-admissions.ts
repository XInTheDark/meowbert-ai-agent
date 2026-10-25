import { DeviceApiError, type DeviceApi } from "./device-api";
import { deviceRetryDelay } from "./retry-delay";
import { startLocalRun, type DeviceRunNotice } from "./local-run";
import type { LocalExecutionReadiness } from "./local-readiness";
import type { DesktopLocalExecutorOptions } from "./local-executor";

// An admitted timestamp identifies one attempt; replaying a snapshot cannot restart it.
export class RunAdmissions {
  private entries: DeviceRunNotice[] = [];
  private attempts = new Map<string, string | null>();
  private failures = new Map<string, number>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(private readonly options: DesktopLocalExecutorOptions, private readonly api: DeviceApi,
    private readonly signal: AbortSignal, private readonly readiness: Pick<LocalExecutionReadiness, "ready" | "capabilities">,
    private readonly runs: Map<string, ReturnType<typeof startLocalRun>>,
    private readonly isCleaning: () => boolean, private readonly onDone: () => void) {
    signal.addEventListener("abort", () => { for (const timer of this.timers) clearTimeout(timer); }, { once: true });
  }
  receive(entries: unknown[]): void {
    this.entries = entries as DeviceRunNotice[];
    for (const id of this.attempts.keys()) {
      if (!this.entries.some(entry => entry.run_id === id && entry.queue_state === "admitted")) {
        this.attempts.delete(id); this.failures.delete(id);
      }
    }
    this.resume();
  }
  resume(): void {
    const ready = this.readiness.ready;
    if (!ready || this.signal.aborted || this.isCleaning()) return;
    for (const entry of this.entries) {
      const admission = entry.admitted_at ?? null;
      if (entry.queue_state !== "admitted" || this.runs.has(entry.run_id) || this.attempts.get(entry.run_id) === admission) continue;
      const target = entry.payload_json.executionTarget;
      if (target?.kind !== "local" || (target.mode === "host" ? !this.options.hostConsent : this.readiness.capabilities.sandboxImageReady !== true)) continue;
      this.attempts.set(entry.run_id, admission);
      const run = startLocalRun(this.options, this.api, entry, ready.image, ready.skillsRoot, ready.settings, ready.installId);
      this.runs.set(entry.run_id, run);
      void run.done.catch(error => {
        this.options.onPendingReason?.(String(error));
        if (error instanceof TypeError || (error instanceof DeviceApiError && (error.status >= 500 || [408, 429].includes(error.status)))) this.retry(entry);
      }).finally(() => { this.runs.delete(entry.run_id); if (!this.signal.aborted) this.onDone(); });
    }
  }
  private retry(entry: DeviceRunNotice): void {
    if (this.signal.aborted) return;
    const attempt = this.failures.get(entry.run_id) ?? 0;
    this.failures.set(entry.run_id, attempt + 1);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.attempts.get(entry.run_id) === (entry.admitted_at ?? null)) this.attempts.delete(entry.run_id);
      this.resume();
    }, deviceRetryDelay(attempt));
    timer.unref(); this.timers.add(timer);
  }
}
