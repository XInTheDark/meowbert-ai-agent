// Task-level harness settings: what the harness does between a task's runs. The user sets limits;
// the agent changes settings only inside them (see docs/planning/harness-settings.md).

export type HarnessActor = "user" | "agent";
export type HarnessNotify = "on_finish" | "on_failure" | "never";

export const HARNESS_NOTIFY_VALUES: readonly HarnessNotify[] = ["on_finish", "on_failure", "never"];

export interface HarnessSetting<T> {
  value: T;
  setBy: HarnessActor;
}

export interface HarnessStopCheck {
  command: string;
  timeoutSeconds: number;
}

export interface HarnessSettings {
  keepAliveUntil: HarnessSetting<string> | null;
  wakeIntervalSeconds: HarnessSetting<number> | null;
  stopCheck: HarnessSetting<HarnessStopCheck> | null;
  tokenBudget: HarnessSetting<number> | null;
  notify: HarnessSetting<HarnessNotify> | null;
  sandboxKeepWarmMinutes: HarnessSetting<number> | null;
}

// A requested change. null leaves a setting unchanged; 0 or "" clears it.
export interface HarnessSettingsChange {
  keepAliveMinutes: number | null;
  wakeIntervalSeconds: number | null;
  stopCheckCommand: string | null;
  stopCheckTimeoutSeconds: number | null;
  tokenBudget: number | null;
  notify: HarnessNotify | "" | null;
  sandboxKeepWarmMinutes: number | null;
}

// The settings a user sets from a task's parameters. Keep-alive is the task's Timed type there.
// A missing key leaves a setting as it is; null clears it.
export interface HarnessUserPatch {
  wakeIntervalSeconds?: number | null;
  stopCheckCommand?: string | null;
  stopCheckTimeoutSeconds?: number | null;
  tokenBudget?: number | null;
  notify?: HarnessNotify | null;
  sandboxKeepWarmMinutes?: number | null;
}

export function harnessChangeFromUserPatch(patch: HarnessUserPatch): HarnessSettingsChange {
  const numberOrClear = (value: number | null | undefined): number | null => (value === undefined ? null : value ?? 0);
  return {
    keepAliveMinutes: null,
    wakeIntervalSeconds: numberOrClear(patch.wakeIntervalSeconds),
    stopCheckCommand: patch.stopCheckCommand === undefined ? null : patch.stopCheckCommand ?? "",
    stopCheckTimeoutSeconds: patch.stopCheckCommand === null ? null : patch.stopCheckTimeoutSeconds ?? null,
    tokenBudget: numberOrClear(patch.tokenBudget),
    notify: patch.notify === undefined ? null : patch.notify ?? "",
    sandboxKeepWarmMinutes: numberOrClear(patch.sandboxKeepWarmMinutes)
  };
}

export function isEmptyHarnessChange(change: HarnessSettingsChange): boolean {
  return Object.values(change).every((value) => value === null);
}

export interface HarnessLimits {
  maxAgentKeepAliveMinutes: number;
  maxSandboxKeepWarmMinutes: number;
  maxStopCheckAttempts: number;
  maxFailedKeepAliveCycles: number;
}

export const DEFAULT_HARNESS_LIMITS: HarnessLimits = {
  maxAgentKeepAliveMinutes: 240,
  maxSandboxKeepWarmMinutes: 30,
  maxStopCheckAttempts: 3,
  maxFailedKeepAliveCycles: 3
};

export const MAX_USER_KEEP_ALIVE_MINUTES = 7 * 24 * 60;
export const MIN_WAKE_INTERVAL_SECONDS = 60;
export const MAX_WAKE_INTERVAL_SECONDS = 24 * 60 * 60;
export const DEFAULT_KEEP_ALIVE_DELAY_SECONDS = 60;
export const MAX_IDLE_BACKOFF_SECONDS = 30 * 60;
export const DEFAULT_STOP_CHECK_TIMEOUT_SECONDS = 600;
export const MIN_STOP_CHECK_TIMEOUT_SECONDS = 10;
export const MAX_STOP_CHECK_TIMEOUT_SECONDS = 3600;

export const EMPTY_HARNESS_SETTINGS: HarnessSettings = {
  keepAliveUntil: null,
  wakeIntervalSeconds: null,
  stopCheck: null,
  tokenBudget: null,
  notify: null,
  sandboxKeepWarmMinutes: null
};

export const NO_HARNESS_SETTINGS_CHANGE: HarnessSettingsChange = {
  keepAliveMinutes: null,
  wakeIntervalSeconds: null,
  stopCheckCommand: null,
  stopCheckTimeoutSeconds: null,
  tokenBudget: null,
  notify: null,
  sandboxKeepWarmMinutes: null
};

export interface HarnessChangeContext {
  actor: HarnessActor;
  now: Date;
  limits: HarnessLimits;
  // The task's own time limit; keep-alive never runs past it.
  taskTimeLimitDeadlineAt: string | null;
}

export type HarnessChangeResult =
  | { ok: true; next: HarnessSettings; changed: Array<keyof HarnessSettings> }
  | { ok: false; error: string };

class HarnessChangeError extends Error {}

function reject(message: string): never {
  throw new HarnessChangeError(message);
}

function assertInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    reject(`${name} must be a whole number from ${min} to ${max}.`);
  }
}

// Settings the agent may add, replace or clear only while the user hasn't set them.
function assertAgentMayReplace(ctx: HarnessChangeContext, current: HarnessSetting<unknown> | null, label: string): void {
  if (ctx.actor === "agent" && current?.setBy === "user") {
    reject(`The user set ${label}; only the user can change it.`);
  }
}

function applyKeepAlive(current: HarnessSettings, minutes: number, ctx: HarnessChangeContext): HarnessSettings["keepAliveUntil"] {
  const existing = current.keepAliveUntil;
  if (minutes === 0) {
    if (ctx.actor === "agent" && existing?.setBy === "user") {
      reject("The user set keep-alive; only the user can end it.");
    }
    return null;
  }
  const max = ctx.actor === "agent" ? ctx.limits.maxAgentKeepAliveMinutes : MAX_USER_KEEP_ALIVE_MINUTES;
  assertInteger("keep_alive_minutes", minutes, 1, max);
  const until = new Date(ctx.now.getTime() + minutes * 60_000);
  if (ctx.taskTimeLimitDeadlineAt && until.getTime() > new Date(ctx.taskTimeLimitDeadlineAt).getTime()) {
    reject(`Keep-alive can't run past the task's time limit (${ctx.taskTimeLimitDeadlineAt}).`);
  }
  if (ctx.actor === "agent" && existing?.setBy === "user" && until.getTime() < new Date(existing.value).getTime()) {
    reject(`The user kept this task alive until ${existing.value}; you can extend that, not shorten it.`);
  }
  // Extending the user's keep-alive keeps it the user's, so the agent still can't end it.
  return { value: until.toISOString(), setBy: existing?.setBy === "user" ? "user" : ctx.actor };
}

function applyOptionalNumber(
  current: HarnessSetting<number> | null,
  value: number,
  ctx: HarnessChangeContext,
  spec: { name: string; label: string; min: number; max: number }
): HarnessSetting<number> | null {
  assertAgentMayReplace(ctx, current, spec.label);
  if (value === 0) return null;
  assertInteger(spec.name, value, spec.min, spec.max);
  return { value, setBy: ctx.actor };
}

function applyStopCheck(current: HarnessSettings["stopCheck"], change: HarnessSettingsChange, ctx: HarnessChangeContext): HarnessSettings["stopCheck"] {
  assertAgentMayReplace(ctx, current, "the stop check");
  const timeoutSeconds = change.stopCheckTimeoutSeconds ?? current?.value.timeoutSeconds ?? DEFAULT_STOP_CHECK_TIMEOUT_SECONDS;
  assertInteger("stop_check_timeout_seconds", timeoutSeconds, MIN_STOP_CHECK_TIMEOUT_SECONDS, MAX_STOP_CHECK_TIMEOUT_SECONDS);
  if (change.stopCheckCommand === null) {
    if (!current) reject("Set stop_check_command before its timeout.");
    return { value: { command: current.value.command, timeoutSeconds }, setBy: ctx.actor };
  }
  const command = change.stopCheckCommand.trim();
  if (!command) return null;
  return { value: { command, timeoutSeconds }, setBy: ctx.actor };
}

function applyTokenBudget(current: HarnessSettings["tokenBudget"], value: number, ctx: HarnessChangeContext): HarnessSettings["tokenBudget"] {
  if (value === 0) {
    if (ctx.actor === "agent") reject("You can lower the token budget but not remove it.");
    return null;
  }
  assertInteger("token_budget", value, 1, Number.MAX_SAFE_INTEGER);
  if (ctx.actor === "agent" && current && value > current.value) {
    reject(`You can lower the token budget but not raise it (now ${current.value}).`);
  }
  // A lowered user budget stays the user's: the agent still can't raise it back.
  return { value, setBy: current?.setBy === "user" ? "user" : ctx.actor };
}

function applyNotify(current: HarnessSettings["notify"], value: HarnessNotify | "", ctx: HarnessChangeContext): HarnessSettings["notify"] {
  assertAgentMayReplace(ctx, current, "notifications");
  if (value === "") return null;
  if (!HARNESS_NOTIFY_VALUES.includes(value)) reject("notify must be on_finish, on_failure or never.");
  return { value, setBy: ctx.actor };
}

function applyAll(current: HarnessSettings, change: HarnessSettingsChange, ctx: HarnessChangeContext): HarnessSettings {
  const next: HarnessSettings = { ...current };
  if (change.keepAliveMinutes !== null) next.keepAliveUntil = applyKeepAlive(current, change.keepAliveMinutes, ctx);
  if (change.wakeIntervalSeconds !== null) {
    next.wakeIntervalSeconds = applyOptionalNumber(current.wakeIntervalSeconds, change.wakeIntervalSeconds, ctx,
      { name: "wake_interval_seconds", label: "the wake interval", min: MIN_WAKE_INTERVAL_SECONDS, max: MAX_WAKE_INTERVAL_SECONDS });
  }
  if (change.stopCheckCommand !== null || change.stopCheckTimeoutSeconds !== null) {
    next.stopCheck = applyStopCheck(current.stopCheck, change, ctx);
  }
  if (change.tokenBudget !== null) next.tokenBudget = applyTokenBudget(current.tokenBudget, change.tokenBudget, ctx);
  if (change.notify !== null) next.notify = applyNotify(current.notify, change.notify, ctx);
  if (change.sandboxKeepWarmMinutes !== null) {
    next.sandboxKeepWarmMinutes = applyOptionalNumber(current.sandboxKeepWarmMinutes, change.sandboxKeepWarmMinutes, ctx,
      { name: "sandbox_keep_warm_minutes", label: "the warm sandbox", min: 1, max: ctx.limits.maxSandboxKeepWarmMinutes });
  }
  return next;
}

// Applies a change with the authority rules for its actor. One rejected key rejects the whole change.
export function applyHarnessSettingsChange(
  current: HarnessSettings,
  change: HarnessSettingsChange,
  ctx: HarnessChangeContext
): HarnessChangeResult {
  try {
    const next = applyAll(current, change, ctx);
    const changed = (Object.keys(next) as Array<keyof HarnessSettings>)
      .filter((key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]));
    return { ok: true, next, changed };
  } catch (error) {
    if (error instanceof HarnessChangeError) return { ok: false, error: error.message };
    throw error;
  }
}

export function isKeepAliveActive(settings: Pick<HarnessSettings, "keepAliveUntil">, now: Date = new Date()): boolean {
  return settings.keepAliveUntil !== null && new Date(settings.keepAliveUntil.value).getTime() > now.getTime();
}

export function hasActiveHarnessSettings(settings: HarnessSettings, now: Date = new Date()): boolean {
  return isKeepAliveActive(settings, now)
    || settings.stopCheck !== null
    || settings.tokenBudget !== null
    || settings.notify !== null
    || settings.sandboxKeepWarmMinutes !== null;
}

// The wait before the next keep-alive cycle: the wake interval (or a minute), doubled for each
// consecutive idle cycle up to 30 minutes, or the wake interval when that is longer.
export function computeKeepAliveDelaySeconds(input: { wakeIntervalSeconds: number | null; idleCycles: number }): number {
  const base = input.wakeIntervalSeconds ?? DEFAULT_KEEP_ALIVE_DELAY_SECONDS;
  const cap = Math.max(MAX_IDLE_BACKOFF_SECONDS, base);
  const exponent = Math.min(Math.max(0, input.idleCycles), 20);
  return Math.min(cap, base * 2 ** exponent);
}


// Whether a notification goes out for this kind of event under the task's notify setting. The
// default, on_finish, notifies for answers only, as tasks always have.
export function shouldNotifyForHarnessEvent(notify: HarnessNotify | null, event: "finish" | "failure"): boolean {
  switch (notify ?? "on_finish") {
    case "on_finish": return event === "finish";
    case "on_failure": return event === "failure";
    case "never": return false;
  }
}
