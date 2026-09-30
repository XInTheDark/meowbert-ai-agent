export interface UsageAdjustmentWindow {
  startUtc: string;
  endUtc: string;
  currentUsage: number;
}

export interface UsageAdjustmentEvent {
  occurredAtUtc: string;
  delta: number;
}

export function dedupeUsageWindows(windows: UsageAdjustmentWindow[]): UsageAdjustmentWindow[] {
  const byWindow = new Map<string, UsageAdjustmentWindow>();
  for (const window of windows) {
    byWindow.set(`${window.startUtc}:${window.endUtc}`, window);
  }
  return Array.from(byWindow.values());
}

export function buildUsageAdjustmentEvents(input: {
  windows: UsageAdjustmentWindow[];
  targetUsage: number;
  referenceDate: Date;
}): UsageAdjustmentEvent[] {
  const targetUsage = Math.max(0, Math.floor(input.targetUsage));
  const referenceMs = input.referenceDate.getTime();
  const windows = dedupeUsageWindows(input.windows)
    .map((window) => ({
      ...window,
      startMs: new Date(window.startUtc).getTime(),
      endMs: new Date(window.endUtc).getTime()
    }))
    .filter((window) => Number.isFinite(window.startMs) && Number.isFinite(window.endMs) && window.startMs < window.endMs)
    .sort((left, right) => right.startMs - left.startMs);

  const events: UsageAdjustmentEvent[] = [];
  for (const [index, window] of windows.entries()) {
    const priorDelta = events.reduce((sum, event) => {
      const eventMs = new Date(event.occurredAtUtc).getTime();
      return eventMs >= window.startMs && eventMs < window.endMs ? sum + event.delta : sum;
    }, 0);
    const delta = targetUsage - (Math.floor(window.currentUsage) + priorDelta);
    if (delta === 0) {
      continue;
    }

    const nextLaterStartMs = index === 0 ? null : windows[index - 1].startMs;
    const latestMs = Math.min(
      window.endMs - 1,
      referenceMs - 1,
      nextLaterStartMs === null ? referenceMs - 1 : nextLaterStartMs - 1
    );
    const occurredAtMs = Math.max(window.startMs, latestMs);
    if (occurredAtMs >= window.endMs || (nextLaterStartMs !== null && occurredAtMs >= nextLaterStartMs)) {
      throw new Error("Unable to isolate usage adjustment windows");
    }

    events.push({
      occurredAtUtc: new Date(occurredAtMs).toISOString(),
      delta
    });
  }

  return events;
}
