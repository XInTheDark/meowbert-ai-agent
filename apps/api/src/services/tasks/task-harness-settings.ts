import {
  harnessChangeFromUserPatch,
  isEmptyHarnessChange,
  type HarnessSettings,
  type HarnessUserPatch
} from "@meowbert/shared";
import {
  loadHarnessTask,
  updateHarnessSettingsInTx,
  type HarnessSettingsDb
} from "@meowbert/shared/harness-settings-store";
import { config } from "../../lib/config.js";

// Applies the harness settings a user set with the task's parameters. Call it inside the
// transaction that changes the task, after its schedule, since the wake interval needs keep-alive.
export async function applyUserHarnessPatchInTx(client: HarnessSettingsDb, input: {
  taskId: string;
  userId: string | null;
  patch: HarnessUserPatch | undefined;
}): Promise<void> {
  if (!input.patch) return;
  const change = harnessChangeFromUserPatch(input.patch);
  if (isEmptyHarnessChange(change)) return;
  await updateHarnessSettingsInTx(client, {
    taskId: input.taskId,
    actor: "user",
    actorUserId: input.userId,
    change,
    limits: config.harness,
    now: new Date()
  });
}

export async function loadTaskHarnessSettings(client: HarnessSettingsDb, taskId: string): Promise<HarnessSettings | null> {
  return (await loadHarnessTask(client, taskId))?.settings ?? null;
}
