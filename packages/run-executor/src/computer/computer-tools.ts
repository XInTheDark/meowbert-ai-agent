import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

export const COMPUTER_SCREENSHOT_TOOL_NAME = "computer_screenshot";
export const COMPUTER_CURSOR_POSITION_TOOL_NAME = "computer_cursor_position";
export const COMPUTER_MOUSE_MOVE_TOOL_NAME = "computer_mouse_move";
export const COMPUTER_LEFT_CLICK_TOOL_NAME = "computer_left_click";
export const COMPUTER_LEFT_CLICK_DRAG_TOOL_NAME = "computer_left_click_drag";
export const COMPUTER_RIGHT_CLICK_TOOL_NAME = "computer_right_click";
export const COMPUTER_MIDDLE_CLICK_TOOL_NAME = "computer_middle_click";
export const COMPUTER_DOUBLE_CLICK_TOOL_NAME = "computer_double_click";
export const COMPUTER_TRIPLE_CLICK_TOOL_NAME = "computer_triple_click";
export const COMPUTER_SCROLL_TOOL_NAME = "computer_scroll";
export const COMPUTER_TYPE_TOOL_NAME = "computer_type";
export const COMPUTER_KEY_TOOL_NAME = "computer_key";
export const COMPUTER_HOLD_KEY_TOOL_NAME = "computer_hold_key";
export const COMPUTER_LEFT_MOUSE_DOWN_TOOL_NAME = "computer_left_mouse_down";
export const COMPUTER_LEFT_MOUSE_UP_TOOL_NAME = "computer_left_mouse_up";
export const COMPUTER_WAIT_TOOL_NAME = "computer_wait";
export const COMPUTER_LOCAL_SHELL_TOOL_NAME = "computer_local_shell";

export const computerNoArgsSchema = z.object({});
export const computerPointSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0)
});
export const computerDragSchema = z.object({
  start_x: z.number().int().min(0),
  start_y: z.number().int().min(0),
  end_x: z.number().int().min(0),
  end_y: z.number().int().min(0)
});
export const computerScrollSchema = z.object({
  delta_x: z.number().int(),
  delta_y: z.number().int()
});
export const computerTypeSchema = z.object({
  text: z.string()
});
export const computerKeySchema = z.object({
  keys: z.string().min(1)
});
export const computerHoldKeySchema = z.object({
  key: z.string().min(1),
  duration_ms: z.number().int().min(0).max(30_000)
});
export const computerWaitSchema = z.object({
  duration_ms: z.number().int().min(0).max(30_000)
});
export const computerLocalShellSchema = z.object({
  command: z.string().min(1),
  timeout_seconds: z.number().int().min(1).max(600).nullable()
});

function buildPointTool(name: string, description: string): FunctionTool {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", minimum: 0 },
        y: { type: "number", minimum: 0 }
      },
      required: ["x", "y"],
      additionalProperties: false
    }
  };
}

function buildNoArgsTool(name: string, description: string): FunctionTool {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  };
}

export const COMPUTER_RESPONSE_FUNCTION_TOOLS: FunctionTool[] = [
  buildNoArgsTool(
    COMPUTER_SCREENSHOT_TOOL_NAME,
    "Capture the current desktop state. Returns a fresh screenshot and coordinate-space metadata for future actions."
  ),
  buildNoArgsTool(
    COMPUTER_CURSOR_POSITION_TOOL_NAME,
    "Read the current cursor position and return a fresh screenshot."
  ),
  buildPointTool(
    COMPUTER_MOUSE_MOVE_TOOL_NAME,
    "Move the mouse to (x, y) in the latest screenshot coordinate space, then return a fresh screenshot."
  ),
  buildPointTool(
    COMPUTER_LEFT_CLICK_TOOL_NAME,
    "Move to (x, y), perform a single left click, then return a fresh screenshot."
  ),
  {
    type: "function",
    name: COMPUTER_LEFT_CLICK_DRAG_TOOL_NAME,
    description:
      "Drag from (start_x, start_y) to (end_x, end_y) in the latest screenshot coordinate space, then return a fresh screenshot.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        start_x: { type: "number", minimum: 0 },
        start_y: { type: "number", minimum: 0 },
        end_x: { type: "number", minimum: 0 },
        end_y: { type: "number", minimum: 0 }
      },
      required: ["start_x", "start_y", "end_x", "end_y"],
      additionalProperties: false
    }
  },
  buildPointTool(
    COMPUTER_RIGHT_CLICK_TOOL_NAME,
    "Move to (x, y), perform a right click, then return a fresh screenshot."
  ),
  buildPointTool(
    COMPUTER_MIDDLE_CLICK_TOOL_NAME,
    "Move to (x, y), perform a middle click, then return a fresh screenshot."
  ),
  buildPointTool(
    COMPUTER_DOUBLE_CLICK_TOOL_NAME,
    "Move to (x, y), perform a double click, then return a fresh screenshot."
  ),
  buildPointTool(
    COMPUTER_TRIPLE_CLICK_TOOL_NAME,
    "Move to (x, y), perform a triple click, then return a fresh screenshot."
  ),
  {
    type: "function",
    name: COMPUTER_SCROLL_TOOL_NAME,
    description:
      "Scroll the current view by delta_x and delta_y. Positive delta_y scrolls down; negative delta_y scrolls up. Returns a fresh screenshot.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        delta_x: { type: "number" },
        delta_y: { type: "number" }
      },
      required: ["delta_x", "delta_y"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: COMPUTER_TYPE_TOOL_NAME,
    description: "Type the provided text at the current focused location, then return a fresh screenshot.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: COMPUTER_KEY_TOOL_NAME,
    description:
      "Press a key or key combination like `enter`, `tab`, `cmd+l`, or `ctrl+shift+tab`, then return a fresh screenshot.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        keys: { type: "string" }
      },
      required: ["keys"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: COMPUTER_HOLD_KEY_TOOL_NAME,
    description: "Hold a single key for duration_ms milliseconds, then return a fresh screenshot.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
        duration_ms: { type: "number", minimum: 0, maximum: 30000 }
      },
      required: ["key", "duration_ms"],
      additionalProperties: false
    }
  },
  buildPointTool(
    COMPUTER_LEFT_MOUSE_DOWN_TOOL_NAME,
    "Move to (x, y), press and hold the left mouse button, then return a fresh screenshot."
  ),
  buildPointTool(
    COMPUTER_LEFT_MOUSE_UP_TOOL_NAME,
    "Move to (x, y), release the left mouse button, then return a fresh screenshot."
  ),
  {
    type: "function",
    name: COMPUTER_WAIT_TOOL_NAME,
    description: "Wait for duration_ms milliseconds, then return a fresh screenshot.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        duration_ms: { type: "number", minimum: 0, maximum: 30000 }
      },
      required: ["duration_ms"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: COMPUTER_LOCAL_SHELL_TOOL_NAME,
    description:
      "Run a shell command on the local machine that is running Meowbert Desktop. Use this for local desktop commands, not the remote task workspace.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_seconds: { type: ["number", "null"], minimum: 1, maximum: 600 }
      },
      required: ["command", "timeout_seconds"],
      additionalProperties: false
    }
  }
];
