import type { RunHarnessState } from "@meowbert/run-executor/agent/ports/run-bootstrap";
import { withConnection } from "../../lib/db.js";
import { harnessLimits } from "./service.js";
import { loadHarnessTask } from "@meowbert/shared/harness-settings-store";

// The harness settings a run starts with.
export async function loadRunHarnessState(taskId: string, options: { isProjectMaster: boolean }): Promise<RunHarnessState | null> {
  const task = await withConnection((client) => loadHarnessTask(client, taskId));
  if (!task) return null;
  return {
    settings: task.settings,
    spentTokens: task.spentTokens,
    maxStopCheckAttempts: harnessLimits().maxStopCheckAttempts,
    agentMayChange: task.isRootTask && !task.readOnly && !options.isProjectMaster && task.workflowType !== "long_horizon"
  };
}
