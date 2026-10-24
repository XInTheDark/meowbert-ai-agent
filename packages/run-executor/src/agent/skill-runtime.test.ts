import { describe, expect, it } from "vitest";
import { buildSkillRuntimeEnv } from "./skill-runtime.js";

describe("buildSkillRuntimeEnv", () => {
  it("provides task and workspace directories for bundled skills", () => {
    expect(buildSkillRuntimeEnv({
      taskDir: "/tmp/task-1",
      workspaceRoot: "/tmp/workspace-1"
    })).toEqual({
      TASK_DIR: "/tmp/task-1",
      MEOWBERT_TASK_DIR: "/tmp/task-1",
      WORKSPACE_ROOT: "/tmp/workspace-1",
      MEOWBERT_WORKSPACE_ROOT: "/tmp/workspace-1"
    });
  });

  it("provides canvas directories when a task is attached to an interactive canvas", () => {
    expect(buildSkillRuntimeEnv({
      taskDir: "/tmp/task-1",
      workspaceRoot: "/tmp/workspace-1",
      canvas: {
        id: "canvas-1",
        absolutePath: "/tmp/env/canvases/demo",
        entryPath: "index.html"
      }
    })).toEqual({
      TASK_DIR: "/tmp/task-1",
      MEOWBERT_TASK_DIR: "/tmp/task-1",
      WORKSPACE_ROOT: "/tmp/workspace-1",
      MEOWBERT_WORKSPACE_ROOT: "/tmp/workspace-1",
      CANVAS_DIR: "/tmp/env/canvases/demo",
      MEOWBERT_CANVAS_DIR: "/tmp/env/canvases/demo",
      CANVAS_ID: "canvas-1",
      CANVAS_ENTRY_PATH: "index.html"
    });
  });
});
