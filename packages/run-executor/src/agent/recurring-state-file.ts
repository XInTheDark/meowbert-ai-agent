import fs from "node:fs";
import path from "node:path";
import type { RunScheduleInfo } from "./ports/run-bootstrap.js";

// TASK.md in the task's state directory: the recurring task's durable notes across runs.
export function ensureRecurringTaskStateFile(input: {
  taskRootPath: string;
  envRoot: string;
  schedule: RunScheduleInfo;
  objective: string;
}): string {
  const stateDir = path.resolve(input.envRoot, input.taskRootPath, "state");
  const taskFilePath = path.resolve(stateDir, "TASK.md");
  fs.mkdirSync(stateDir, { recursive: true });

  if (!fs.existsSync(taskFilePath)) {
    const content = [
      `# Recurring Task State`,
      "",
      `- Root path: ${input.taskRootPath}`,
      `- Mode: ${input.schedule.mode}`,
      `- Timezone: ${input.schedule.timezone}`,
      input.schedule.mode === "scheduled" && input.schedule.repeat
        ? `- Repeat: ${input.schedule.repeat}`
        : "- Repeat: managed by wait tool",
      input.schedule.runTimeoutSeconds
        ? `- Run time limit: ${input.schedule.runTimeoutSeconds}s`
        : "- Run time limit: none",
      input.schedule.runDeadlineAt
        ? `- Current deadline: ${input.schedule.runDeadlineAt}`
        : "- Current deadline: none",
      "",
      "## Objective",
      input.objective.trim() || "No objective provided.",
      "",
      "## Operating Notes",
      "- Keep this file updated with durable context, assumptions, and next actions.",
      "- When context is compacted, rely on this file to preserve continuity.",
      "- Keep entries concise and practical."
    ].join("\n");

    fs.writeFileSync(taskFilePath, `${content}\n`, "utf-8");
  }

  return taskFilePath;
}
