import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { HarnessSettings, HarnessSettingsChange } from "@meowbert/shared";
import { HARNESS_SETTINGS_TOOL_NAME, harnessSettingsArgumentsSchema } from "../../agent-tools/index.js";
import type { HarnessSettingsSnapshot } from "../../agent/ports/platform-tools.js";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";

function describeSetting<T>(setting: { value: T; setBy: string } | null): { value: T; set_by: string } | null {
  return setting ? { value: setting.value, set_by: setting.setBy } : null;
}

// The full state the agent sees after every call, so it never has to guess what changed.
export function describeHarnessSnapshot(snapshot: HarnessSettingsSnapshot): Record<string, unknown> {
  const { settings } = snapshot;
  return {
    keep_alive: settings.keepAliveUntil ? { until: settings.keepAliveUntil.value, set_by: settings.keepAliveUntil.setBy } : null,
    wake_interval_seconds: describeSetting(settings.wakeIntervalSeconds),
    stop_check: settings.stopCheck
      ? { command: settings.stopCheck.value.command, timeout_seconds: settings.stopCheck.value.timeoutSeconds, set_by: settings.stopCheck.setBy }
      : null,
    token_budget: settings.tokenBudget ? { ...describeSetting(settings.tokenBudget), spent: snapshot.spentTokens } : null,
    notify: describeSetting(settings.notify),
    sandbox_keep_warm_minutes: describeSetting(settings.sandboxKeepWarmMinutes),
    limits: {
      latest_keep_alive_until: snapshot.latestAgentKeepAliveUntil,
      max_sandbox_keep_warm_minutes: snapshot.maxSandboxKeepWarmMinutes
    }
  };
}

function toChange(args: ReturnType<typeof harnessSettingsArgumentsSchema.parse>): HarnessSettingsChange {
  return {
    keepAliveMinutes: args.keep_alive_minutes,
    wakeIntervalSeconds: args.wake_interval_seconds,
    stopCheckCommand: args.stop_check_command,
    stopCheckTimeoutSeconds: args.stop_check_timeout_seconds,
    tokenBudget: args.token_budget,
    notify: args.notify,
    sandboxKeepWarmMinutes: args.sandbox_keep_warm_minutes
  };
}

function applyToRun(ctx: ToolDispatchContext, settings: HarnessSettings): void {
  if (!ctx.harness) return;
  const stopCheckChanged = JSON.stringify(ctx.harness.settings.stopCheck) !== JSON.stringify(settings.stopCheck);
  ctx.harness.settings = settings;
  if (stopCheckChanged) ctx.harness.stopCheckFailures = 0;
}

export async function handleHarnessSettings(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  if (ctx.swarm?.run.lane) {
    return toolErrorResult("Lanes can't change harness settings; the leader owns them.");
  }
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(HARNESS_SETTINGS_TOOL_NAME, outputItem.arguments, harnessSettingsArgumentsSchema);
  if (!parsed.ok) return toolErrorResult(parsed.error);

  const change = toChange(parsed.value);
  const requested = Object.fromEntries(Object.entries(parsed.value).filter(([, value]) => value !== null));
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Harness",
    inputText: summarizeToolEventValue(requested) ?? "Read harness settings"
  });
  try {
    const snapshot = await ctx.control.platform.updateHarnessSettings(change);
    applyToRun(ctx, snapshot.settings);
    return await finishBuiltinToolSuccess(ctx, execution, { ok: true, ...describeHarnessSnapshot(snapshot) }, {
      eventPayload: { harnessKeys: Object.keys(requested) }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Harness settings unchanged: ${message}`);
  }
}
