import { describe, expect, it } from "vitest";
import { createSwarmActivity, formatActivityNotes, recordFilesWritten, recordSearchQuery, recordWebSearchCall } from "@meowbert/run-executor/agent-swarm/activity";
import { resolveLaneMaxSteps, resolveLaneToolChoice } from "@meowbert/run-executor/agent-swarm/forced-submit";
import { buildMergeMessage } from "./merge-message.js";
import { takeUntilBlockedNote } from "./notes-store.js";
import { shouldNudgeRecon } from "./recon-nudge.js";
import { buildTurnNotes, formatLaneStatus } from "./turn-notes.js";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";

describe("forced submit", () => {
  it("forces the submit call on the lane's last step, or as soon as the runtime stops it", () => {
    expect(resolveLaneToolChoice({ step: 3, maxRunSteps: 5, forced: false })).toBe("required");
    expect(resolveLaneToolChoice({ step: 4, maxRunSteps: 5, forced: false })).toEqual({ type: "function", name: "submit" });
    expect(resolveLaneToolChoice({ step: 0, maxRunSteps: 5, forced: true })).toEqual({ type: "function", name: "submit" });
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

describe("diverge and check results", () => {
  const settings = normalizeAgentSwarmSettings({});
  const answer = (id: string, title: string, summary: string) => ({
    task_id: id,
    title,
    kind: "diverge" as const,
    status: "done" as const,
    created_at: "2026-10-23T00:00:00Z",
    result_json: {
      summary,
      decisions: [{ choice: "Free tier", reason: "Adoption.", would_change_if: "Support costs exceed 10%." }],
      findings: null,
      files: []
    }
  });

  it("shows diverged answers without their titles, in a shuffled order, with their decisions", () => {
    const lanes = [answer("a", "Price on value", "Value pricing."), answer("b", "Undercut", "Low pricing.")];
    // A random source of 0 swaps the last answer to the front.
    const message = buildMergeMessage(lanes, settings, () => 0);
    expect(message).not.toContain("Price on value");
    expect(message).not.toContain("Undercut");
    expect(message.indexOf("Low pricing.")).toBeLessThan(message.indexOf("Value pricing."));
    expect(message).toContain("## Answer 1");
    expect(message).toContain("Would change if: Support costs exceed 10%.");
  });

  it("lists Check findings with their severity and location", () => {
    const check = {
      task_id: "c",
      title: "Check",
      kind: "check" as const,
      status: "done" as const,
      created_at: "2026-10-23T00:00:00Z",
      result_json: {
        summary: "One expired deadline.",
        decisions: null,
        findings: [{ severity: "must_fix", location: "Table row 4", issue: "The 2026 deadline has passed." }],
        files: []
      }
    };
    expect(buildMergeMessage([check], settings)).toContain("- [must_fix] Table row 4: The 2026 deadline has passed.");
  });
});

describe("diverge note blindness", () => {
  it("delivers ancestor notes up to the first sibling note and holds the rest", () => {
    const notes = [
      { seq: "1", author_task_id: "parent" },
      { seq: "2", author_task_id: "sibling" },
      { seq: "3", author_task_id: "parent" }
    ];
    expect(takeUntilBlockedNote(notes, ["parent"]).map((note) => note.seq)).toEqual(["1"]);
    expect(takeUntilBlockedNote(notes.filter((note) => note.author_task_id === "parent"), ["parent"])).toHaveLength(2);
  });
});

describe("leader turn view", () => {
  it("lists active lanes under their parents and stays silent when there is nothing to show", () => {
    const lane = (id: string, parent: string, title: string) => ({
      task_id: id, parent_task_id: parent, depth: parent === "root" ? 1 : 2, kind: "split" as const,
      title, status: "running" as const, steps: 4, latest_notes: null
    });
    const lines = formatLaneStatus([lane("eu", "root", "EU"), lane("eic", "eu", "EIC"), lane("pt", "root", "PT2030")], "root");
    expect(lines.map((line) => line.split(" (")[0])).toEqual(["- EU", "  - EIC", "- PT2030"]);
    expect(buildTurnNotes({ active: [], dormant: [] })).toBeNull();
  });

  it("nudges a leader once, after its solo steps on a user turn with no lanes running", () => {
    const base = { isLeader: true, isUserTurn: true, hasActiveLanes: false, stepCount: 12, reconNudgeSteps: 12 };
    expect(shouldNudgeRecon(base)).toBe(true);
    expect(shouldNudgeRecon({ ...base, stepCount: 13 })).toBe(false);
    expect(shouldNudgeRecon({ ...base, hasActiveLanes: true })).toBe(false);
    expect(shouldNudgeRecon({ ...base, reconNudgeSteps: 0, stepCount: 0 })).toBe(false);
  });
});
