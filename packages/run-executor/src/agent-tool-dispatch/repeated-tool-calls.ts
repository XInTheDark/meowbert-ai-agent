import { SHELL_SESSION_TOOL_NAME } from "../agent-tools/shared.js";
import type { ToolDispatchState } from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

export function trackRepeatedToolCall(
  state: ToolDispatchState,
  name: string,
  argumentsText: string
): string | null {
  if (name !== SHELL_SESSION_TOOL_NAME) {
    state.repeatedToolCall = undefined;
    return null;
  }

  let parameters = argumentsText;
  try {
    parameters = JSON.stringify(canonicalize(JSON.parse(argumentsText)));
  } catch {
    // The tool will report invalid arguments; repeated identical input still counts.
  }

  const previous = state.repeatedToolCall;
  const count = previous?.name === name && previous.parameters === parameters ? previous.count + 1 : 1;
  state.repeatedToolCall = { name, parameters, count };
  if (count < 3) return null;

  return "You have repeated the same shell_session call three or more times. Use `wait` with this session's `on_exit` or `on_output` condition when a command is running; use the result already returned when it is not. Do not poll with `status`.";
}
