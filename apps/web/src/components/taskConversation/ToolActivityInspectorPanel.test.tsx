/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolActivityInspectorPanel } from "./ToolActivityInspectorPanel";
import { resolveToolInspectorSelection } from "./shared";
import type { LiveToolCall, TaskMessage } from "../../lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createMockToolMessage(id: string, tool = "run_shell", command = "echo hello"): TaskMessage {
  return {
    id,
    role: "tool",
    content_json: {
      tool,
      command,
      stdout: `Output for ${id}`,
      exitCode: 0,
      durationMs: 120
    },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: "2026-08-28T10:00:00.000Z"
  };
}

describe("ToolActivityInspectorPanel", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("renders loading indicator only when zero messages are hydrated initially", async () => {
    const msg1 = createMockToolMessage("tool-1");
    const msg2 = createMockToolMessage("tool-2");
    const onExpandRequested = vi.fn();

    await act(async () => {
      root?.render(
        <ToolActivityInspectorPanel
          selection={{
            kind: "historical",
            groupKey: "tool-group:tool-1",
            toolGroup: [msg1, msg2]
          }}
          hydratedMessageIds={new Set<string>()}
          toolDisclosureState={{}}
          interruptingLiveToolCallIds={[]}
          onClose={vi.fn()}
          onToolDisclosureChange={vi.fn()}
          onExpandRequested={onExpandRequested}
        />
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Loading tool calls…");
    expect(onExpandRequested).toHaveBeenCalledWith(["tool-1", "tool-2"]);
  });

  it("renders tool call list when at least one message is hydrated, without full loading state", async () => {
    const msg1 = createMockToolMessage("tool-1", "run_shell", "pwd");
    const msg2 = createMockToolMessage("tool-2", "run_shell", "ls");

    await act(async () => {
      root?.render(
        <ToolActivityInspectorPanel
          selection={{
            kind: "historical",
            groupKey: "tool-group:tool-1",
            toolGroup: [msg1, msg2]
          }}
          hydratedMessageIds={new Set(["tool-1"])}
          toolDisclosureState={{}}
          interruptingLiveToolCallIds={[]}
          onClose={vi.fn()}
          onToolDisclosureChange={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("Loading tool calls…");
    expect(document.body.querySelectorAll(".tool-inspector-call-item").length).toBe(2);
  });

  it("does not unmount or show full loading indicator when a new unhydrated tool call arrives", async () => {
    const msg1 = createMockToolMessage("tool-1");
    const msg2 = createMockToolMessage("tool-2");
    const msg3 = createMockToolMessage("tool-3");

    await act(async () => {
      root?.render(
        <ToolActivityInspectorPanel
          selection={{
            kind: "historical",
            groupKey: "tool-group:tool-1",
            toolGroup: [msg1, msg2]
          }}
          hydratedMessageIds={new Set(["tool-1", "tool-2"])}
          toolDisclosureState={{}}
          interruptingLiveToolCallIds={[]}
          onClose={vi.fn()}
          onToolDisclosureChange={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(document.body.querySelectorAll(".tool-inspector-call-item").length).toBe(2);
    expect(document.body.textContent).not.toContain("Loading tool calls…");

    // A new tool call arrives (msg3), not yet in hydratedMessageIds
    await act(async () => {
      root?.render(
        <ToolActivityInspectorPanel
          selection={{
            kind: "historical",
            groupKey: "tool-group:tool-1",
            toolGroup: [msg1, msg2, msg3]
          }}
          hydratedMessageIds={new Set(["tool-1", "tool-2"])}
          toolDisclosureState={{}}
          interruptingLiveToolCallIds={[]}
          onClose={vi.fn()}
          onToolDisclosureChange={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("Loading tool calls…");
    expect(document.body.querySelectorAll(".tool-inspector-call-item").length).toBe(3);
  });

  it("handles live tool calls and close button", async () => {
    const liveCall: LiveToolCall = {
      id: "live-1",
      callId: "call-1",
      toolName: "run_shell",
      command: "npm test",
      inputLabel: "Command",
      inputText: "npm test",
      startedAt: "2026-08-28T10:00:00.000Z",
      step: 1,
      interruptible: true
    };

    const onClose = vi.fn();
    await act(async () => {
      root?.render(
        <ToolActivityInspectorPanel
          selection={{
            kind: "live",
            groupKey: "live-tool-calls",
            liveToolCalls: [liveCall]
          }}
          hydratedMessageIds={new Set()}
          toolDisclosureState={{}}
          interruptingLiveToolCallIds={[]}
          onClose={onClose}
          onToolDisclosureChange={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Running now");
    expect(document.body.textContent).toContain("1 active call");

    const closeBtn = document.body.querySelector<HTMLButtonElement>(".tool-inspector-close-btn");
    expect(closeBtn).not.toBeNull();
    await act(async () => closeBtn?.click());
    expect(onClose).toHaveBeenCalled();
  });
});

describe("resolveToolInspectorSelection", () => {
  it("transitions smoothly from live to latest historical tool group when live tool calls finish", () => {
    const historicalMsg = createMockToolMessage("tool-1");
    const messages = [historicalMsg];

    const result = resolveToolInspectorSelection(
      {
        kind: "live",
        groupKey: "live-tool-calls",
        liveToolCalls: []
      },
      messages,
      []
    );

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("historical");
    expect(result?.groupKey).toBe("tool-group:tool-1");
  });

  it("updates historical tool group with newly appended tool messages in same group", () => {
    const msg1 = createMockToolMessage("tool-1");
    const msg2 = createMockToolMessage("tool-2");

    const initial = resolveToolInspectorSelection(
      {
        kind: "historical",
        groupKey: "tool-group:tool-1",
        toolGroup: [msg1]
      },
      [msg1, msg2],
      []
    );

    expect(initial?.kind).toBe("historical");
    if (initial?.kind === "historical") {
      expect(initial.toolGroup.length).toBe(2);
      expect(initial.toolGroup[1].id).toBe("tool-2");
    }
  });
});
