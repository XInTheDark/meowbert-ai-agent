/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskMessage } from "../../lib/types";
import { TaskConversationMessages } from "./TaskConversationMessages";

vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspaceApp: () => ({ api: { post: vi.fn() } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function message(id: string, role: TaskMessage["role"], content_json: Record<string, unknown>): TaskMessage {
  return { id, role, content_json, created_at: "2026-09-11T00:00:00.000Z", parent_message_id: null, edited_from_message_id: null };
}
const tools = [1, 2, 3].map((index) => message(`tool-${index}`, "tool", { tool: "run_shell", command: `echo ${index}`, durationMs: 100 }));
const notice = message("retry-1", "system", { text: "Model request failed (attempt 1/6): Timed out. Retrying in 3s..." });
const recovery = message("recovery-1", "system", { text: "[System: Recovered missing tool output for function call tool-2.]" });

describe("consolidated conversation activity", () => {
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

  it("shows one activity card and a separate notice list with working inspectors", () => {
    const onExpandRequested = vi.fn();
    act(() => root.render(<TaskConversationMessages messages={[tools[0], notice, tools[1], recovery, tools[2]]}
      onToolGroupExpandRequested={onExpandRequested} isTaskRunning />));
    expect(container.querySelectorAll(".tool-activity-card")).toHaveLength(1);
    expect(container.querySelector(".tool-activity-card")?.textContent).toContain("3 calls");
    expect(container.querySelectorAll(".activity-notices-button")).toHaveLength(1);
    expect(container.textContent).not.toContain("Timed out.");
    expect(container.querySelector(".activity-notices")?.getAttribute("data-message-ids")).toBe("retry-1 recovery-1");
    act(() => container.querySelector<HTMLButtonElement>(".activity-notices-button")?.click());
    expect(container.querySelectorAll(".activity-notices-list li")).toHaveLength(2);
    expect(container.querySelector(".activity-notices-list")?.textContent).toContain("Timed out.");
    expect(container.querySelector(".activity-notices-list")?.textContent).toContain("Recovered missing tool output");
    expect(onExpandRequested).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>(".tool-inspector-close-btn")?.click());
    act(() => container.querySelector<HTMLButtonElement>(".tool-activity-card")?.click());
    expect(onExpandRequested).toHaveBeenCalledWith(["tool-1", "tool-2", "tool-3"]);
  });

  it("updates a selected activity group as tools arrive after a retry", () => {
    act(() => root.render(<TaskConversationMessages messages={[tools[0]]} hydratedMessageIds={new Set(["tool-1"])} isTaskRunning />));
    act(() => container.querySelector<HTMLButtonElement>(".tool-activity-card")?.click());
    act(() => root.render(<TaskConversationMessages messages={[tools[0], notice, tools[1]]} hydratedMessageIds={new Set(["tool-1", "tool-2"])} isTaskRunning />));
    expect(container.querySelectorAll(".tool-activity-card")).toHaveLength(1);
    expect(container.querySelectorAll(".tool-inspector-call-item")).toHaveLength(2);
    expect(container.querySelector(".tool-activity-card.active")).not.toBeNull();
  });

  it("keeps retry status current and makes recovered errors accessible", () => {
    act(() => root.render(<TaskConversationMessages messages={[tools[0], notice]} />));
    expect(container.querySelector(".activity-notices-retry")?.textContent).toContain("attempt 1/6");
    act(() => container.querySelector<HTMLButtonElement>(".activity-notices-button")?.click());
    act(() => root.render(<TaskConversationMessages messages={[tools[0], notice, recovery, tools[1]]} />));
    expect(container.querySelector(".activity-notices-retry")).toBeNull();
    expect(container.querySelectorAll(".activity-notices-list li")).toHaveLength(2);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector(".tool-inspector-panel")).toBeNull();
  });

  it("folds finished activity to one line and remembers when it is opened", () => {
    const reply = message("assistant-1", "assistant", { text: "Done." });
    const stored = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    } });
    act(() => root.render(<TaskConversationMessages taskId="task-1" messages={[tools[0], tools[1]]} isTaskRunning />));
    expect(container.querySelector(".activity-disclosure")).toBeNull();
    expect(container.querySelectorAll(".tool-activity-card")).toHaveLength(1);

    act(() => root.render(<TaskConversationMessages taskId="task-1" messages={[tools[0], tools[1], reply]} isTaskRunning />));
    const toggle = () => container.querySelector<HTMLButtonElement>(".activity-disclosure-toggle");
    expect(toggle()?.textContent).toContain("2 calls");
    expect(container.querySelector(".tool-activity-card")).toBeNull();

    act(() => toggle()?.click());
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".tool-activity-card .tool-activity-card-title")).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<TaskConversationMessages taskId="task-1" messages={[tools[0], tools[1], reply]} />));
    expect(container.querySelectorAll(".tool-activity-card")).toHaveLength(1);
  });
});
