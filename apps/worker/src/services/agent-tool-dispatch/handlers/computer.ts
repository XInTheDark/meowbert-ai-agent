import type {
  ResponseFunctionToolCall,
  ResponseInputContent,
  ResponseInputItem
} from "openai/resources/responses/responses";
import type { ComputerToolName } from "@meowbert/shared";
import {
  COMPUTER_CURSOR_POSITION_TOOL_NAME,
  COMPUTER_DOUBLE_CLICK_TOOL_NAME,
  COMPUTER_HOLD_KEY_TOOL_NAME,
  COMPUTER_KEY_TOOL_NAME,
  COMPUTER_LEFT_CLICK_DRAG_TOOL_NAME,
  COMPUTER_LEFT_CLICK_TOOL_NAME,
  COMPUTER_LOCAL_SHELL_TOOL_NAME,
  COMPUTER_LEFT_MOUSE_DOWN_TOOL_NAME,
  COMPUTER_LEFT_MOUSE_UP_TOOL_NAME,
  COMPUTER_MIDDLE_CLICK_TOOL_NAME,
  COMPUTER_MOUSE_MOVE_TOOL_NAME,
  COMPUTER_RESPONSE_FUNCTION_TOOLS,
  COMPUTER_RIGHT_CLICK_TOOL_NAME,
  COMPUTER_SCREENSHOT_TOOL_NAME,
  COMPUTER_SCROLL_TOOL_NAME,
  COMPUTER_TRIPLE_CLICK_TOOL_NAME,
  COMPUTER_TYPE_TOOL_NAME,
  COMPUTER_WAIT_TOOL_NAME,
  computerDragSchema,
  computerHoldKeySchema,
  computerKeySchema,
  computerLocalShellSchema,
  computerNoArgsSchema,
  computerPointSchema,
  computerScrollSchema,
  computerTypeSchema,
  computerWaitSchema
} from "../../computer/computer-tools.js";
import { parseToolArguments } from "../../agent/utils.js";
import { getDesktopComputerPresence, requestDesktopComputerAction } from "../../computer/computer-use.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled } from "../utils.js";

const DEFAULT_COMPUTER_TOOL_TIMEOUT_MS = 60_000;
const COMPUTER_LOCAL_SHELL_DEFAULT_TIMEOUT_SECONDS = 30;
const COMPUTER_LOCAL_SHELL_TIMEOUT_BUFFER_MS = 15_000;

function formatArgsForDisplay(toolName: string, args: Record<string, unknown>): string | null {
  switch (toolName) {
    case COMPUTER_SCREENSHOT_TOOL_NAME:
      return "Capture the current desktop.";
    case COMPUTER_CURSOR_POSITION_TOOL_NAME:
      return "Read the current cursor position.";
    case COMPUTER_MOUSE_MOVE_TOOL_NAME:
    case COMPUTER_LEFT_CLICK_TOOL_NAME:
    case COMPUTER_RIGHT_CLICK_TOOL_NAME:
    case COMPUTER_MIDDLE_CLICK_TOOL_NAME:
    case COMPUTER_DOUBLE_CLICK_TOOL_NAME:
    case COMPUTER_TRIPLE_CLICK_TOOL_NAME:
    case COMPUTER_LEFT_MOUSE_DOWN_TOOL_NAME:
    case COMPUTER_LEFT_MOUSE_UP_TOOL_NAME:
      return `(${args.x}, ${args.y})`;
    case COMPUTER_LEFT_CLICK_DRAG_TOOL_NAME:
      return `(${args.start_x}, ${args.start_y}) -> (${args.end_x}, ${args.end_y})`;
    case COMPUTER_SCROLL_TOOL_NAME:
      return `delta_x=${args.delta_x}, delta_y=${args.delta_y}`;
    case COMPUTER_TYPE_TOOL_NAME:
      return typeof args.text === "string" ? args.text : null;
    case COMPUTER_KEY_TOOL_NAME:
      return typeof args.keys === "string" ? args.keys : null;
    case COMPUTER_HOLD_KEY_TOOL_NAME:
      return typeof args.key === "string" ? `${args.key} for ${args.duration_ms}ms` : null;
    case COMPUTER_WAIT_TOOL_NAME:
      return `${args.duration_ms}ms`;
    case COMPUTER_LOCAL_SHELL_TOOL_NAME:
      return typeof args.command === "string" ? args.command : null;
    default:
      return null;
  }
}

function getComputerToolTimeoutMs(toolName: ComputerToolName, args: Record<string, unknown>): number {
  if (toolName !== COMPUTER_LOCAL_SHELL_TOOL_NAME) {
    return toolName === COMPUTER_WAIT_TOOL_NAME ? 90_000 : DEFAULT_COMPUTER_TOOL_TIMEOUT_MS;
  }

  const requestedSeconds =
    typeof args.timeout_seconds === "number" && Number.isFinite(args.timeout_seconds)
      ? Math.max(1, Math.round(args.timeout_seconds))
      : COMPUTER_LOCAL_SHELL_DEFAULT_TIMEOUT_SECONDS;

  return Math.max(
    DEFAULT_COMPUTER_TOOL_TIMEOUT_MS,
    (requestedSeconds * 1_000) + COMPUTER_LOCAL_SHELL_TIMEOUT_BUFFER_MS
  );
}

function buildComputerMessagePayload(toolName: ComputerToolName, output: Record<string, unknown>): Record<string, unknown> {
  if (toolName !== COMPUTER_LOCAL_SHELL_TOOL_NAME) {
    return {};
  }

  return {
    ...(typeof output.cwd === "string" ? { cwd: output.cwd } : {}),
    ...(typeof output.stdout === "string" ? { stdout: output.stdout } : {}),
    ...(typeof output.stderr === "string" ? { stderr: output.stderr } : {}),
    ...(typeof output.exitCode === "number" ? { exitCode: output.exitCode } : {}),
    ...(typeof output.timedOut === "boolean" ? { timedOut: output.timedOut } : {})
  };
}

function buildObservationItem(input: {
  text: string;
  imageDataUrl: string;
  detail: "high" | "original";
}): ResponseInputItem {
  const content: ResponseInputContent[] = [
    {
      type: "input_text",
      text: input.text
    },
    {
      type: "input_image",
      detail: input.detail,
      image_url: input.imageDataUrl
    }
  ];

  return {
    role: "user",
    content
  };
}

function parseComputerToolArguments(outputItem: ResponseFunctionToolCall): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  switch (outputItem.name) {
    case COMPUTER_SCREENSHOT_TOOL_NAME:
    case COMPUTER_CURSOR_POSITION_TOOL_NAME:
      return parseToolArguments(outputItem.name, outputItem.arguments, computerNoArgsSchema) as ReturnType<typeof parseComputerToolArguments>;
    case COMPUTER_MOUSE_MOVE_TOOL_NAME:
    case COMPUTER_LEFT_CLICK_TOOL_NAME:
    case COMPUTER_RIGHT_CLICK_TOOL_NAME:
    case COMPUTER_MIDDLE_CLICK_TOOL_NAME:
    case COMPUTER_DOUBLE_CLICK_TOOL_NAME:
    case COMPUTER_TRIPLE_CLICK_TOOL_NAME:
    case COMPUTER_LEFT_MOUSE_DOWN_TOOL_NAME:
    case COMPUTER_LEFT_MOUSE_UP_TOOL_NAME:
      return parseToolArguments(outputItem.name, outputItem.arguments, computerPointSchema) as ReturnType<typeof parseComputerToolArguments>;
    case COMPUTER_LEFT_CLICK_DRAG_TOOL_NAME:
      return parseToolArguments(outputItem.name, outputItem.arguments, computerDragSchema) as ReturnType<typeof parseComputerToolArguments>;
    case COMPUTER_SCROLL_TOOL_NAME:
      return parseToolArguments(outputItem.name, outputItem.arguments, computerScrollSchema) as ReturnType<typeof parseComputerToolArguments>;
    case COMPUTER_TYPE_TOOL_NAME:
      return parseToolArguments(outputItem.name, outputItem.arguments, computerTypeSchema) as ReturnType<typeof parseComputerToolArguments>;
    case COMPUTER_KEY_TOOL_NAME:
      return parseToolArguments(outputItem.name, outputItem.arguments, computerKeySchema) as ReturnType<typeof parseComputerToolArguments>;
    case COMPUTER_HOLD_KEY_TOOL_NAME:
      return parseToolArguments(outputItem.name, outputItem.arguments, computerHoldKeySchema) as ReturnType<typeof parseComputerToolArguments>;
    case COMPUTER_WAIT_TOOL_NAME:
      return parseToolArguments(outputItem.name, outputItem.arguments, computerWaitSchema) as ReturnType<typeof parseComputerToolArguments>;
    case COMPUTER_LOCAL_SHELL_TOOL_NAME:
      return parseToolArguments(outputItem.name, outputItem.arguments, computerLocalShellSchema) as ReturnType<typeof parseComputerToolArguments>;
    default:
      return {
        ok: false,
        error: `Unsupported computer tool: ${outputItem.name}`
      };
  }
}

export async function handleComputerToolCall(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult | null> {
  if (!COMPUTER_RESPONSE_FUNCTION_TOOLS.some((tool) => tool.name === outputItem.name)) {
    return null;
  }

  await ctx.assertNotCancelled();
  const toolName = outputItem.name as ComputerToolName;
  const parsed = parseComputerToolArguments(outputItem);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: toolName === COMPUTER_LOCAL_SHELL_TOOL_NAME ? null : "Computer action",
    inputText: toolName === COMPUTER_LOCAL_SHELL_TOOL_NAME ? null : formatArgsForDisplay(outputItem.name, parsed.value),
    command: toolName === COMPUTER_LOCAL_SHELL_TOOL_NAME && typeof parsed.value.command === "string"
      ? parsed.value.command
      : null
  });

  try {
    if (!ctx.actorUserId) {
      return await finishBuiltinToolFailure(ctx, execution, "Computer use requires a signed-in desktop user.");
    }

    const presence = await getDesktopComputerPresence(ctx.actorUserId);
    if (!presence || presence.status.available !== true) {
      return await finishBuiltinToolFailure(
        ctx,
        execution,
        presence?.status.reason ?? "No connected Meowbert Desktop executor is available for this user."
      );
    }

    const result = await requestDesktopComputerAction({
      userId: ctx.actorUserId,
      taskId: ctx.taskId,
      toolName,
      args: parsed.value,
      timeoutMs: getComputerToolTimeoutMs(toolName, parsed.value)
    });

    if (!result.ok) {
      return await finishBuiltinToolFailure(
        ctx,
        execution,
        result.error ?? "The desktop computer executor reported an unknown error."
      );
    }

    const shownItems = result.observation?.imageDataUrl
      ? [buildObservationItem({
          text: result.observation.text,
          imageDataUrl: result.observation.imageDataUrl,
          detail: ctx.imageDetail ?? "high"
        })]
      : [];

    const finished = await finishBuiltinToolSuccess(ctx, execution, result.output ?? { ok: true }, {
      eventPayload: {
        computerUse: true,
        ...(result.observation?.display ? { display: result.observation.display } : {}),
        ...(result.observation?.cursor ? { cursor: result.observation.cursor } : {})
      },
      messagePayload: {
        ...buildComputerMessagePayload(toolName, result.output ?? {}),
        computerUse: true,
        ...(result.observation?.text ? { observationText: result.observation.text } : {}),
        ...(result.observation?.display ? { display: result.observation.display } : {}),
        ...(result.observation?.cursor ? { cursor: result.observation.cursor } : {})
      }
    });
    return { ...finished, shownItems };
  } catch (error) {
    rethrowIfTaskCancelled(error);
    return finishBuiltinToolFailure(
      ctx,
      execution,
      error instanceof Error ? error.message : String(error)
    );
  }
}
