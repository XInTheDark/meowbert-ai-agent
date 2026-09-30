import { describe, expect, it } from "vitest";
import { applyLiveToolEvent, deriveLiveToolCalls, toLiveToolCall } from "./liveToolCalls";
import type { LiveEvent } from "../lib/types";

function createEvent(type: string, payload: Record<string, unknown>, createdAt = "2026-03-08T10:00:00.000Z"): LiveEvent {
  return {
    id: `${type}:${createdAt}:${JSON.stringify(payload)}`,
    type,
    createdAt,
    payload
  };
}

describe("toLiveToolCall", () => {
  it("prefers input text for non-shell builtin tools", () => {
    const event = createEvent("command_start", {
      callId: "call-memory-1",
      tool: "memory_search",
      step: 3,
      inputLabel: "Query",
      inputText: "recent deployment notes"
    });

    expect(toLiveToolCall(event)).toEqual({
      id: "call-memory-1",
      callId: "call-memory-1",
      toolName: "memory_search",
      step: 3,
      command: null,
      inputLabel: "Query",
      inputText: "recent deployment notes",
      interruptible: false,
      startedAt: "2026-03-08T10:00:00.000Z"
    });
  });
});

describe("applyLiveToolEvent", () => {
  it("matches command_end by callId", () => {
    const started = applyLiveToolEvent([], createEvent("command_start", {
      callId: "call-1",
      tool: "memory_search",
      step: 1,
      inputLabel: "Query",
      inputText: "notes"
    }));

    const finished = applyLiveToolEvent(started, createEvent("command_end", {
      callId: "call-1",
      tool: "memory_search",
      step: 1
    }));

    expect(finished).toEqual([]);
  });

  it("clears live calls when task leaves running states", () => {
    const started = applyLiveToolEvent([], createEvent("command_start", {
      callId: "call-1",
      tool: "run_shell",
      step: 1,
      command: "echo ok",
      inputLabel: "Command",
      inputText: "echo ok",
      interruptible: true
    }));

    const cleared = applyLiveToolEvent(started, createEvent("status", { status: "failed" }));
    expect(cleared).toEqual([]);
  });
});

describe("deriveLiveToolCalls", () => {
  it("reconstructs running tools from event history", () => {
    const calls = deriveLiveToolCalls([
      createEvent("command_start", {
        callId: "call-shell-1",
        tool: "run_shell",
        step: 0,
        command: "npm test",
        inputLabel: "Command",
        inputText: "npm test",
        interruptible: true
      }, "2026-03-08T10:00:00.000Z"),
      createEvent("command_end", {
        callId: "call-shell-1",
        tool: "run_shell",
        step: 0
      }, "2026-03-08T10:00:03.000Z"),
      createEvent("command_start", {
        callId: "call-memory-1",
        tool: "memory_search",
        step: 1,
        inputLabel: "Query",
        inputText: "deployment notes"
      }, "2026-03-08T10:00:04.000Z")
    ]);

    expect(calls).toEqual([
      {
        id: "call-memory-1",
        callId: "call-memory-1",
        toolName: "memory_search",
        step: 1,
        command: null,
        inputLabel: "Query",
        inputText: "deployment notes",
        interruptible: false,
        startedAt: "2026-03-08T10:00:04.000Z"
      }
    ]);
  });
});
