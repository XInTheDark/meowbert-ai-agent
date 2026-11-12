import { describe, expect, it } from "vitest";
import { applyTaskProgressUpdate, type TaskProgress } from "./task-progress.js";

const current: TaskProgress = {
  goal: "Build the handout",
  status: "Drafted the outline.\n\nWaiting on the style guide.",
  steps: [
    { title: "Read the style guide", status: "done", note: "Uses sentence case headings." },
    { title: "Write the draft", status: "active", note: "Two sections left." }
  ]
};

describe("applyTaskProgressUpdate", () => {
  it("keeps every field the update leaves null", () => {
    expect(applyTaskProgressUpdate(current, { goal: null, status: "Draft is done.", steps: null })).toEqual({
      ...current,
      status: "Draft is done."
    });
  });

  it("keeps a step's note by title when the update sends the list without it", () => {
    const next = applyTaskProgressUpdate(current, {
      goal: null,
      status: null,
      steps: [
        { title: "Read the style guide", status: "done", note: null },
        { title: "Write the draft", status: "done", note: null },
        { title: "Proofread", status: "active", note: null }
      ]
    });
    expect(next?.steps.map((step) => step.note)).toEqual(["Uses sentence case headings.", "Two sections left.", null]);
  });

  it("starts a new plan when the goal changes", () => {
    const next = applyTaskProgressUpdate(current, {
      goal: "Fix the login bug",
      status: null,
      steps: [{ title: "Write the draft", status: "active", note: null }]
    });
    expect(next).toEqual({ goal: "Fix the login bug", status: null, steps: [{ title: "Write the draft", status: "active", note: null }] });
  });

  it("clears the steps when the update sends an empty list", () => {
    expect(applyTaskProgressUpdate(current, { goal: null, status: null, steps: [] })?.steps).toEqual([]);
    expect(applyTaskProgressUpdate(current, { goal: "Fix the login bug", status: "Starting.", steps: [] })).toEqual({
      goal: "Fix the login bug",
      status: "Starting.",
      steps: []
    });
  });

  it("keeps paragraph breaks in the status", () => {
    const next = applyTaskProgressUpdate(null, { goal: "Plan", status: "  First   part.\n\n\n Second part. ", steps: null });
    expect(next?.status).toBe("First part.\n\nSecond part.");
  });
});
