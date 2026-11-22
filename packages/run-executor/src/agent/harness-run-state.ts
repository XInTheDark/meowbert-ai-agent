import { EMPTY_HARNESS_SETTINGS, isKeepAliveActive, type HarnessSettings } from "@meowbert/shared";
import type { RunHarnessState, RunScheduleInfo } from "./ports/run-bootstrap.js";

// A run's view of its task's harness settings, kept current as the agent changes them.
export interface HarnessRunState {
  settings: HarnessSettings;
  agentMayChange: boolean;
  maxStopCheckAttempts: number;
  // Rejected final_response calls in a row because the stop check failed.
  stopCheckFailures: number;
  spentTokensAtStart: number;
  // Tokens this run's model turns used, counted against the token budget.
  runTokens: number;
  // Tokens not yet added to the task's total.
  unsavedTokens: number;
  budgetExhausted: boolean;
  // Tool calls other than the ones that only end, report on or configure a cycle.
  substantiveToolCalls: number;
}

// Calls that don't count as work when deciding whether a keep-alive cycle was idle.
const CYCLE_BOOKKEEPING_TOOLS = new Set([
  "final_response",
  "wait",
  "send_message",
  "harness_settings",
  "update_progress",
  "enable_skill",
  "list_skills"
]);

export function createHarnessRunState(harness: RunHarnessState | null | undefined): HarnessRunState {
  return {
    settings: harness?.settings ?? EMPTY_HARNESS_SETTINGS,
    agentMayChange: harness?.agentMayChange === true,
    maxStopCheckAttempts: harness?.maxStopCheckAttempts ?? 3,
    stopCheckFailures: 0,
    spentTokensAtStart: harness?.spentTokens ?? 0,
    runTokens: 0,
    unsavedTokens: 0,
    budgetExhausted: false,
    substantiveToolCalls: 0
  };
}

export function recordHarnessToolCall(state: HarnessRunState | undefined, toolName: string): void {
  if (state && !CYCLE_BOOKKEEPING_TOOLS.has(toolName)) state.substantiveToolCalls += 1;
}

export function isHarnessKeepAliveOn(state: HarnessRunState, now: Date = new Date()): boolean {
  return isKeepAliveActive(state.settings, now);
}

export function isIdleHarnessCycle(state: HarnessRunState): boolean {
  return state.substantiveToolCalls === 0;
}

// Adds a model turn's tokens and reports whether the task's budget is now used up.
export function recordHarnessTokens(state: HarnessRunState, tokens: number): boolean {
  state.runTokens += Math.max(0, tokens);
  state.unsavedTokens += Math.max(0, tokens);
  const budget = state.settings.tokenBudget?.value;
  if (budget !== undefined && state.spentTokensAtStart + state.runTokens >= budget) state.budgetExhausted = true;
  return state.budgetExhausted;
}

function formatMinutesLeft(untilIso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((new Date(untilIso).getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

function describeSettings(settings: HarnessSettings): string[] {
  const lines: string[] = [];
  if (settings.wakeIntervalSeconds) lines.push(`wake interval ${settings.wakeIntervalSeconds.value}s (${settings.wakeIntervalSeconds.setBy})`);
  if (settings.stopCheck) lines.push(`stop check \`${settings.stopCheck.value.command}\` (${settings.stopCheck.setBy})`);
  if (settings.tokenBudget) lines.push(`token budget ${settings.tokenBudget.value} (${settings.tokenBudget.setBy})`);
  if (settings.notify) lines.push(`notify ${settings.notify.value} (${settings.notify.setBy})`);
  if (settings.sandboxKeepWarmMinutes) lines.push(`warm sandbox ${settings.sandboxKeepWarmMinutes.value} min (${settings.sandboxKeepWarmMinutes.setBy})`);
  return lines;
}

const WAKE_REASONS: Record<string, string> = {
  failure: "The previous cycle failed; this one retries it."
};

// The note a run opens with when the task has harness settings. It goes in the conversation, not
// the prompt prefix, since it carries per-run state.
export function buildHarnessRunNotice(input: {
  state: HarnessRunState;
  scheduleInfo: RunScheduleInfo | null;
  isKeepAliveCycle: boolean;
  spentTokens: number;
  now?: Date;
}): string | null {
  const now = input.now ?? new Date();
  const { settings } = input.state;
  const keepAlive = isKeepAliveActive(settings, now) ? settings.keepAliveUntil : null;
  const others = describeSettings(settings);
  if (!keepAlive && others.length === 0) return null;
  const parts: string[] = [];
  if (keepAlive) {
    parts.push(input.isKeepAliveCycle
      ? `Keep-alive cycle: ${formatMinutesLeft(keepAlive.value, now)} left, until ${keepAlive.value} (set by the ${keepAlive.setBy}). Verify, improve or continue the work; final_response ends this cycle and the next one starts after the wake interval.`
      : `Keep-alive is on until ${keepAlive.value} (set by the ${keepAlive.setBy}); final_response ends a cycle and the harness starts the next one.`);
    const reason = input.isKeepAliveCycle && input.scheduleInfo?.lastWakeReason ? WAKE_REASONS[input.scheduleInfo.lastWakeReason] : undefined;
    if (reason) parts.push(reason);
  }
  if (others.length > 0) parts.push(`Harness settings: ${others.join("; ")}.`);
  if (settings.tokenBudget) parts.push(`Tokens used so far: ${input.spentTokens} of ${settings.tokenBudget.value}.`);
  if (input.state.agentMayChange) parts.push("Load the harness-settings tool group with enable_skill to read how these work or change them.");
  return `[System: ${parts.join(" ")}]`;
}
