import { describe, expect, it } from "vitest";
import { createSwarmActivity, formatActivityNotes, recordFilesWritten, recordSearchQuery, recordWebSearchCall } from "./auto-notes.js";
import { resolveLaneMaxSteps, resolveLaneToolChoice } from "./forced-submit.js";
import { buildMergeMessage } from "./merge-message.js";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";

describe("forced submit", () => {
  it("forces the submit call on the lane's last step only", () => {
    expect(resolveLaneToolChoice({ step: 3, maxRunSteps: 5 })).toBe("required");
    expect(resolveLaneToolChoice({ step: 4, maxRunSteps: 5 })).toEqual({ type: "function", name: "submit" });
  });

  it("caps a lane at its own step limit, or the task's when it has none", () => {
    expect(resolveLaneMaxSteps(null, 80)).toBe(80);
    expect(resolveLaneMaxSteps(20, 80)).toBe(20);
    expect(resolveLaneMaxSteps(200, 80)).toBe(80);
  });
});

describe("automatic notes", () => {
  it("groups one step's activity into a note per category without repeats", () => {
    const activity = createSwarmActivity();
    recordFilesWritten(activity, ["/lanes/a/eu.md", "/lanes/a/eu.md"]);
    recordSearchQuery(activity, "EIC accelerator 2027");
    recordWebSearchCall(activity, { type: "web_search_call", id: "ws", status: "completed", action: { type: "open_page", url: "https://cinea.ec.europa.eu/x" } } as never);
    recordWebSearchCall(activity, { type: "web_search_call", id: "ws2", status: "completed", action: { type: "open_page", url: "https://portugal2030.pt/y" } } as never);

    const notes = formatActivityNotes(activity);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatch(/^wrote 1 file/);
    expect(notes[2]).toBe("opened 2 pages (cinea.ec.europa.eu, portugal2030.pt)");
  });
});

describe("merge message", () => {
  const lane = (bytes: number) => ({
    task_id: `lane-${bytes}`,
    title: "Section",
    kind: "split" as const,
    status: "done" as const,
    created_at: "2026-10-23T00:00:00Z",
    result_json: { summary: "Wrote it.", decisions: null, findings: null, files: [{ path: "/lanes/s.md", bytes }] }
  });

  it("suggests an assembly lane only when the parts are larger than the hint", () => {
    const settings = normalizeAgentSwarmSettings({ advanced: { assemblyHintTokens: 1_000 } });
    expect(buildMergeMessage([lane(2_000)], settings)).not.toMatch(/assembly lane/);
    expect(buildMergeMessage([lane(2_000), lane(6_000)], settings)).toMatch(/assembly lane/);
  });
});
