import type { LiveEvent, LiveToolCall } from "../lib/types";

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function buildLiveToolCallId(event: LiveEvent): string {
  const callId = readString(event.payload.callId);
  if (callId) {
    return callId;
  }

  const toolName = readString(event.payload.tool) ?? "tool";
  const step = readNumber(event.payload.step);
  if (step !== null) {
    return `${toolName}:${step}`;
  }

  return event.id;
}

function matchesLiveToolCall(liveCall: LiveToolCall, event: LiveEvent): boolean {
  const callId = readString(event.payload.callId);
  if (callId && liveCall.callId === callId) {
    return true;
  }

  const step = readNumber(event.payload.step);
  if (step !== null && liveCall.step === step) {
    return true;
  }

  const toolName = readString(event.payload.tool);
  const command = readString(event.payload.command);
  if (toolName && command && liveCall.toolName === toolName && liveCall.command === command) {
    return true;
  }

  return false;
}

export function toLiveToolCall(event: LiveEvent): LiveToolCall | null {
  if (event.type !== "command_start") {
    return null;
  }

  const toolName = readString(event.payload.tool) ?? "run_shell";
  const command = readString(event.payload.command);
  const inputText = readString(event.payload.inputText) ?? command ?? "";
  const inputLabel = readString(event.payload.inputLabel) ?? (command ? "Command" : "Input");

  return {
    id: buildLiveToolCallId(event),
    callId: readString(event.payload.callId),
    toolName,
    step: readNumber(event.payload.step),
    command,
    inputLabel,
    inputText,
    interruptible: readBoolean(event.payload.interruptible) === true,
    startedAt: event.createdAt
  };
}

export function applyLiveToolEvent(current: LiveToolCall[], event: LiveEvent): LiveToolCall[] {
  if (event.type === "command_start") {
    const nextCall = toLiveToolCall(event);
    if (!nextCall) {
      return current;
    }

    const next = current.filter((call) => !matchesLiveToolCall(call, event));
    next.push(nextCall);
    return next;
  }

  if (event.type === "command_end") {
    return current.filter((call) => !matchesLiveToolCall(call, event));
  }

  if (event.type === "status") {
    const statusValue = readString(event.payload.status);
    if (
      statusValue
      && statusValue !== "running"
      && statusValue !== "starting"
      && statusValue !== "queued"
      && statusValue !== "awaiting_input"
    ) {
      return [];
    }
  }

  return current;
}

export function deriveLiveToolCalls(events: LiveEvent[]): LiveToolCall[] {
  return events.reduce<LiveToolCall[]>((current, event) => applyLiveToolEvent(current, event), []);
}
