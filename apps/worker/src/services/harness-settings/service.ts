import { isKeepAliveActive, type HarnessActor, type HarnessLimits, type HarnessSettings, type HarnessSettingsChange } from "@meowbert/shared";
import {
  HarnessSettingsError,
  loadHarnessTaskForUpdate,
  updateHarnessSettingsInTx,
  type LoadedHarnessTask
} from "@meowbert/shared/harness-settings-store";
import { withTransaction } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import { assertRecurringTaskLimits } from "../task-schedules/shared.js";

export interface HarnessSettingsSnapshot {
  settings: HarnessSettings;
  spentTokens: number;
  // The latest keep-alive deadline the agent may set right now.
  latestAgentKeepAliveUntil: string | null;
  maxSandboxKeepWarmMinutes: number;
}

export function harnessLimits(): HarnessLimits {
  return config.harness;
}

function latestAgentKeepAliveUntil(task: LoadedHarnessTask, now: Date): string | null {
  const byCap = now.getTime() + harnessLimits().maxAgentKeepAliveMinutes * 60_000;
  const byTimeLimit = task.taskTimeLimitDeadlineAt ? new Date(task.taskTimeLimitDeadlineAt).getTime() : Infinity;
  const latest = Math.min(byCap, byTimeLimit);
  return latest > now.getTime() ? new Date(latest).toISOString() : null;
}

function buildHarnessSnapshot(task: LoadedHarnessTask, settings: HarnessSettings, now: Date): HarnessSettingsSnapshot {
  return {
    settings,
    spentTokens: task.spentTokens,
    latestAgentKeepAliveUntil: latestAgentKeepAliveUntil(task, now),
    maxSandboxKeepWarmMinutes: harnessLimits().maxSandboxKeepWarmMinutes
  };
}

// Applies the agent's harness settings change in one transaction.
export async function updateHarnessSettings(input: {
  taskId: string;
  actor: HarnessActor;
  actorUserId: string | null;
  change: HarnessSettingsChange;
}): Promise<HarnessSettingsSnapshot> {
  const now = new Date();
  const startsKeepAlive = await withTransaction(async (client) => {
    const task = await loadHarnessTaskForUpdate(client, input.taskId);
    if (!task) throw new HarnessSettingsError("Task not found.", 404);
    return !isKeepAliveActive(task.settings, now) && Boolean(input.change.keepAliveMinutes) ? task : null;
  });
  // Starting keep-alive, or restarting a paused one, makes an active schedule, which counts against
  // the recurring task limits.
  if (startsKeepAlive) await assertRecurringTaskLimits(startsKeepAlive.workspaceId, startsKeepAlive.environmentId);

  return withTransaction(async (client) => {
    const { task, settings } = await updateHarnessSettingsInTx(client, { ...input, limits: harnessLimits(), now });
    return buildHarnessSnapshot(task, settings, now);
  });
}
