import { describe, expect, it } from "vitest";
import { resolveAgentTaskInputDir } from "./task-input-dir.js";

describe("resolveAgentTaskInputDir", () => {
  it("uses the task inputs directory for ordinary runs", () => {
    expect(resolveAgentTaskInputDir({
      taskDir: "/tmp/env/.meowbert/task-runs/task-1",
      workflowTaskDir: null
    })).toBe("/tmp/env/.meowbert/task-runs/task-1/inputs");
  });

  it("uses the main workflow task inputs directory for workflow worker runs", () => {
    expect(resolveAgentTaskInputDir({
      taskDir: "/tmp/env/.meowbert/task-runs/worker-1",
      workflowTaskDir: "/tmp/env/.meowbert/task-runs/swarm-main"
    })).toBe("/tmp/env/.meowbert/task-runs/swarm-main/inputs");
  });
});
