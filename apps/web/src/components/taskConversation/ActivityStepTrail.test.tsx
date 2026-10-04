/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveToolCall, TaskMessage } from "../../lib/types";
import { TaskConversationMessages } from "./TaskConversationMessages";

vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspaceApp: () => ({ api: { post: vi.fn() } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function execMessage(id: string, summary: string | null): TaskMessage {
  return {
    id,
    role: "tool",
    content_json: { tool: "exec", inputLabel: "Code", inputText: "await tools.run_shell({ command: \"ls\" });", durationMs: 100, ...(summary ? { summary } : {}) },
    created_at: "2026-10-04T00:00:00.000Z",
    parent_message_id: null,
    edited_from_message_id: null
  };
}

const liveExec: LiveToolCall = {
  id: "call-live",
  callId: "call-live",
  toolName: "exec",
  step: 9,
  command: null,
  inputLabel: "Code",
  inputText: "await tools.run_shell({ command: \"npm test\" });",
  summary: "Running the test suite",
  interruptible: false,
  startedAt: "2026-10-04T00:00:01.000Z"
};

function stepTexts(card: Element | null | undefined): string[] {
  return [...(card?.querySelectorAll(".tool-activity-step") ?? [])].map((step) => step.textContent ?? "");
}

describe("activity step trail", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the last few step summaries a finished group wrote, without repeats", () => {
    const messages = [
      execMessage("tool-1", "Reading the config"),
      execMessage("tool-2", "Finding the failing test"),
      execMessage("tool-3", null),
      execMessage("tool-4", "Patching the parser"),
      execMessage("tool-5", "Patching the parser"),
      execMessage("tool-6", "Re-running the tests")
    ];
    act(() => root.render(<TaskConversationMessages messages={messages} />));
    act(() => container.querySelector<HTMLButtonElement>(".activity-disclosure-toggle")?.click());

    const card = container.querySelector(".tool-activity-card");
    expect(card?.classList.contains("has-steps")).toBe(true);
    expect(stepTexts(card)).toEqual(["Reading the config", "Finding the failing test", "Patching the parser", "Re-running the tests"]);
    expect(card?.querySelector(".tool-activity-step.running")).toBeNull();
  });

  it("keeps the card compact when no step has a summary", () => {
    act(() => root.render(<TaskConversationMessages messages={[execMessage("tool-1", null)]} isTaskRunning />));
    const card = container.querySelector(".tool-activity-card");
    expect(card?.classList.contains("has-steps")).toBe(false);
    expect(stepTexts(card)).toEqual([]);
  });

  it("marks the running step on the live card and in its inspector", () => {
    act(() => root.render(<TaskConversationMessages messages={[]} liveToolCalls={[liveExec]} />));
    const card = container.querySelector(".tool-activity-card");
    expect(card?.querySelector(".tool-activity-step.running")?.textContent).toBe("Running the test suite");

    act(() => container.querySelector<HTMLButtonElement>(".tool-activity-card")?.click());
    expect(container.querySelector(".tool-call-summary")?.textContent).toBe("Running the test suite");
  });
});
