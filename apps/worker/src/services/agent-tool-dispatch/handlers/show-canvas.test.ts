import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  emitTaskEvent: vi.fn(),
  finishBuiltinToolSuccess: vi.fn(async (_ctx: unknown, _execution: unknown, output: unknown) => ({ output })),
  finishBuiltinToolFailure: vi.fn(async (_ctx: unknown, _execution: unknown, error: string) => ({ output: { error } }))
}));

vi.mock("../../../lib/db.js", () => ({ query: mocks.query, withTransaction: vi.fn(), withConnection: vi.fn(), pool: {} }));
vi.mock("../../runtime/events.js", () => ({ emitTaskEvent: mocks.emitTaskEvent }));
vi.mock("@meowbert/run-executor/agent-tool-dispatch/events", () => ({
  startBuiltinToolExecution: vi.fn(async () => ({})),
  finishBuiltinToolSuccess: mocks.finishBuiltinToolSuccess,
  finishBuiltinToolFailure: mocks.finishBuiltinToolFailure
}));

import { handleShowCanvas } from "@meowbert/run-executor/agent-tool-dispatch/handlers/show-canvas";
import { createTestRunControl } from "../../run-host/test-run-environment.test-fixtures.js";

let root: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-show-canvas-")));
  await fs.mkdir(path.join(root, "task"), { recursive: true });
  await fs.mkdir(path.join(root, "canvases/lab/dist"), { recursive: true });
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function createContext(shellEnvOverrides: Record<string, string> = {}): ToolDispatchContext {
  const checkOutput = JSON.stringify({ ok: false, loaded: true, blank: true, errors: [], failed_requests: [], hints: ["blank"] });
  return {
    control: createTestRunControl(),
    taskId: "task-1",
    taskDir: path.join(root, "task"),
    taskScratchDir: path.join(root, "scratch"),
    skillsRootDir: "/app/skills",
    shellEnvOverrides,
    sandbox: { executeShellCommand: vi.fn(async () => ({ stdout: checkOutput, stderr: "", exitCode: 0, timedOut: false })) },
    assertNotCancelled: vi.fn()
  } as unknown as ToolDispatchContext;
}

function call(args: Record<string, unknown>): ResponseFunctionToolCall {
  return {
    type: "function_call",
    call_id: "call-1",
    name: "show_canvas",
    arguments: JSON.stringify({ title: null, display: null, height: null, ...args })
  } as ResponseFunctionToolCall;
}

const state = {} as ToolDispatchState;

describe("handleShowCanvas", () => {
  it("shows a task file inline and returns the check findings", async () => {
    await fs.writeFile(path.join(root, "task/chart.html"), "<p>chart</p>");
    const result = await handleShowCanvas(call({ path: "chart.html" }), createContext(), state);

    expect(result.output).toMatchObject({
      ok: false,
      inline_artifact: { type: "html", relative_path: "chart.html", display: "inline" },
      check: { blank: true, hints: ["blank"] }
    });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.emitTaskEvent).toHaveBeenCalledWith("task-1", "artifact", expect.objectContaining({
      canvasUpdate: { relativePath: "chart.html", canvasId: null, display: "inline" }
    }));
  });

  it("makes a shown project canvas page the canvas entry", async () => {
    const entry = path.join(root, "canvases/lab/dist/index.html");
    await fs.writeFile(entry, "<p>app</p>");
    const ctx = createContext({ CANVAS_ID: "canvas-1", CANVAS_DIR: path.join(root, "canvases/lab"), CANVAS_ENTRY_PATH: "index.html" });
    const result = await handleShowCanvas(call({ path: entry, display: "panel" }), ctx, state);

    expect(result.output).toMatchObject({
      inline_artifact: { relative_path: "dist/index.html", canvas_id: "canvas-1", display: "panel" }
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("entry_path = $2"), ["canvas-1", "dist/index.html", "task-1", "env-1"]);
    expect(ctx.shellEnvOverrides.CANVAS_ENTRY_PATH).toBe("dist/index.html");
  });

  it("refuses files outside the task and canvas directories", async () => {
    await fs.writeFile(path.join(root, "outside.html"), "<p>no</p>");
    const result = await handleShowCanvas(call({ path: path.join(root, "outside.html") }), createContext(), state);

    expect(result.output).toEqual({ error: expect.stringContaining("inside the task directory") });
    expect(mocks.emitTaskEvent).not.toHaveBeenCalled();
  });
});
