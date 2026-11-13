import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";
import type { ToolDispatchContext, ToolDispatchState } from "../../agent-tool-dispatch/types.js";
import { handleSubmit } from "./submit.js";

// Exercise Windows resolution and the real path translation on any test host.
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return { ...actual, default: { ...actual.default, resolve: actual.win32.resolve } };
});

describe("submitted review findings", () => {
  it.each([
    { priority: "P1", location: "Slide 4", issue: "Labels are unreadable." },
    { severity: "must_fix", location: "Slide 4", issue: "Labels are unreadable." }
  ])("preserves findings from current and snapshotted tools: %j", async (finding) => {
    const state = {} as ToolDispatchState;
    const ctx = { taskDir: "/lane", swarm: { run: {
      settings: normalizeAgentSwarmSettings({}), lane: { depth: 1, kind: "check" }
    } } } as ToolDispatchContext;
    const reply = await handleSubmit({ arguments: JSON.stringify({
      summary: "One problem.", decisions: null, findings: [finding], files: []
    }) } as never, ctx, state);
    expect(reply).toEqual({ output: { submitted: true } });
    expect(state.swarmSubmit?.findings).toEqual([finding]);
  });

  it("does not complete a lane with an invalid priority", async () => {
    const state = {} as ToolDispatchState;
    const ctx = { swarm: { run: { settings: normalizeAgentSwarmSettings({}), lane: { kind: "check" } } } } as ToolDispatchContext;
    const reply = await handleSubmit({ arguments: JSON.stringify({
      summary: "Problem.", decisions: null, findings: [{ priority: "P4", location: "Slide 4", issue: "Overlap." }], files: []
    }) } as never, ctx, state);
    expect(reply).toHaveProperty("output.error");
    expect(state.swarmSubmit).toBeUndefined();
  });
});
vi.mock("@meowbert/shared/docker-sandbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meowbert/shared/docker-sandbox")>();
  return { ...actual, fromSandboxPath: (value: string) => actual.fromSandboxPath(value, "win32") };
});
vi.mock("node:fs/promises", () => ({ default: { stat: vi.fn() } }));

describe("submitted lane files on Windows", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["/meowbert-host/drives/c/Workspace/result.md", String.raw`C:\Workspace\result.md`],
    ["/meowbert-host/unc/server/share/result.md", String.raw`\\server\share\result.md`],
    [String.raw`C:\Workspace\result.md`, String.raw`C:\Workspace\result.md`],
    ["result.md", String.raw`C:\Workspace\lane\result.md`]
  ])("records the native path and size for %s", async (submittedPath, nativePath) => {
    vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true, size: 17 } as never);
    const state = {} as ToolDispatchState;
    const ctx = { taskDir: String.raw`C:\Workspace\lane`, swarm: { run: {
      settings: normalizeAgentSwarmSettings({}), lane: { depth: 1, kind: "split" }
    } } } as ToolDispatchContext;
    const reply = await handleSubmit({ arguments: JSON.stringify({
      summary: "Done", decisions: null, findings: null, files: [submittedPath, submittedPath]
    }) } as never, ctx, state);
    expect(reply).toEqual({ output: { submitted: true } });
    expect(fs.stat).toHaveBeenCalledExactlyOnceWith(nativePath);
    expect(state.swarmSubmit?.files).toEqual([{ path: nativePath, bytes: 17 }]);
  });
});
