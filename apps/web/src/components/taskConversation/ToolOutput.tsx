import { useState } from "react";
import { ChevronDown, ChevronRight, Square } from "lucide-react";
import { stripAnsi } from "@meowbert/shared/ansi";
import type { LiveToolCall, TaskMessage } from "../../lib/types";

type ToolOutputProps = (
  | {
      message: TaskMessage;
      liveCall?: never;
    }
  | {
      liveCall: LiveToolCall;
      message?: never;
    }
) & {
  onInterruptRequested?: (liveCall: LiveToolCall) => void;
  interruptPending?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type ToolSectionTone = "neutral" | "success" | "danger";

interface ToolSection {
  id: string;
  label: string;
  text: string;
  tone: ToolSectionTone;
  defaultExpanded?: boolean;
}

interface ParsedToolDisplay {
  title: string;
  isContextManagementTool: boolean;
  status: "running" | "completed" | "interrupted";
  callId: string | null;
  step: number | null;
  durationMs: number | null;
  exitCode: number | null;
  timedOut: boolean;
  sections: ToolSection[];
}

const CONTEXT_MANAGEMENT_TOOL_NAMES = new Set([
  "new_context",
  "get_context_remaining",
  "history_list_windows",
  "history_list_items",
  "history_read_item",
  "history_search_contents",
  "notes_list_files_by_prefix",
  "notes_read_file",
  "notes_search_contents",
  "notes_append_to_file",
  "notes_write_file"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseMaybeJson(raw: string | null): unknown | null {
  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function formatMaybeJson(raw: string, parsed: unknown | null): string {
  if (parsed === null) {
    return raw;
  }

  if (typeof parsed === "string") {
    return parsed;
  }

  return JSON.stringify(parsed, null, 2);
}

function extractResponseArgument(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const response = asString(parsedArguments.response);
  return response && response.trim().length > 0 ? response : null;
}

function hasCommandOnlyArguments(parsedArguments: unknown): boolean {
  if (!isRecord(parsedArguments)) {
    return false;
  }

  const keys = Object.keys(parsedArguments);
  if (keys.length === 0) {
    return false;
  }

  return keys.every((key) => {
    if (key === "command") {
      return true;
    }

    if (
      key === "timeout_seconds"
      || key === "background"
      || key === "background_id"
      || key === "wait_seconds"
      || key === "stop"
    ) {
      const value = parsedArguments[key];
      return value === null || value === false;
    }

    return false;
  });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(durationMs / 1000)}s`;
}

function formatToolName(name: string): string {
  return name.replace(/_/g, " ");
}

function formatWebSearchStatus(status: string | null): string {
  if (status === "completed") {
    return "Search completed.";
  }
  if (status === "searching") {
    return "Searching the web.";
  }
  if (status === "in_progress") {
    return "Search in progress.";
  }
  if (status === "failed") {
    return "Search failed.";
  }

  return "Used the provider web search tool.";
}

function buildFromLiveCall(liveCall: LiveToolCall): ParsedToolDisplay {
  const sections: ToolSection[] = [];
  const label = liveCall.inputLabel.trim().length > 0 ? liveCall.inputLabel : liveCall.command ? "Command" : "Input";
  const text = liveCall.inputText.trim().length > 0 ? liveCall.inputText : liveCall.command ?? "Waiting for tool payload...";
  sections.push({
    id: liveCall.command ? "command" : "input",
    label,
    text,
    tone: "neutral",
    defaultExpanded: true
  });

  return {
    title: formatToolName(liveCall.toolName),
    isContextManagementTool: CONTEXT_MANAGEMENT_TOOL_NAMES.has(liveCall.toolName),
    status: "running",
    callId: liveCall.callId,
    step: liveCall.step,
    durationMs: null,
    exitCode: null,
    timedOut: false,
    sections
  };
}

const HIDDEN_TOOL_PAYLOAD_KEYS = new Set([
  "response_function_call",
  "response_function_output",
  "response_web_search_call",
  "response_custom_tool_call",
  "response_custom_tool_output",
  "response_apply_patch_call",
  "response_apply_patch_output",
  "tool",
  "callId",
  "command",
  "inputLabel",
  "inputText",
  "stdout",
  "stderr",
  "error",
  "interrupted",
  "exitCode",
  "timedOut",
  "durationMs",
  "step",
  "background",
  "background_id",
  "running",
  "stopped",
  "operationCount",
  "paths",
  "absolutePaths"
]);

interface ToolInputSectionParams {
  command: string | null;
  inputText: string | null;
  inputLabel: string | null;
  rawCustomInput: string | null;
  rawApplyPatchInput: string | null;
  rawArguments: string | null;
  parsedArguments: unknown | null;
  responseArgument: string | null;
}

function buildToolInputSections(params: ToolInputSectionParams): ToolSection[] {
  const sections: ToolSection[] = [];

  if (params.command !== null) {
    sections.push({
      id: "command",
      label: "Command",
      text: params.command,
      tone: "neutral",
      defaultExpanded: true
    });
  } else if (params.inputText !== null) {
    sections.push({
      id: "input",
      label: params.inputLabel ?? "Input",
      text: params.inputText,
      tone: "neutral",
      defaultExpanded: true
    });
  } else if (params.rawApplyPatchInput !== null) {
    sections.push({
      id: "patch-input",
      label: "Patch",
      text: params.rawApplyPatchInput,
      tone: "neutral",
      defaultExpanded: true
    });
  } else if (params.rawCustomInput !== null) {
    sections.push({
      id: "custom-input",
      label: "Input",
      text: params.rawCustomInput,
      tone: "neutral",
      defaultExpanded: true
    });
  }

  if (params.rawArguments !== null) {
    if (params.responseArgument !== null) {
      sections.push({
        id: "response",
        label: "Response",
        text: params.responseArgument,
        tone: "neutral",
        defaultExpanded: true
      });
    }

    const shouldSkipArguments = params.command !== null && hasCommandOnlyArguments(params.parsedArguments);
    if (!shouldSkipArguments) {
      sections.push({
        id: "arguments",
        label: "Arguments",
        text: formatMaybeJson(params.rawArguments, params.parsedArguments),
        tone: "neutral"
      });
    }
  }

  return sections;
}

interface ToolOutputSectionParams {
  toolName: string;
  stdout: string | null;
  stderr: string | null;
  errorText: string | null;
  rawFunctionOutput: string | null;
  parsedFunctionOutput: unknown | null;
  functionOutputStdout: string | null;
  functionOutputStderr: string | null;
  rawCustomOutput: string | null;
  rawApplyPatchOutput: string | null;
  webSearchCall: Record<string, unknown> | null;
  webSearchStatus: string | null;
}

function buildToolOutputSections(params: ToolOutputSectionParams): ToolSection[] {
  const sections: ToolSection[] = [];

  if (params.stdout !== null) {
    sections.push({
      id: "stdout",
      label: params.toolName === "apply_patch" ? "Result" : "Stdout",
      text: params.stdout,
      tone: "success"
    });
  }

  if (params.stderr !== null) {
    sections.push({
      id: "stderr",
      label: "Stderr",
      text: params.stderr,
      tone: "danger"
    });
  }

  if (params.errorText !== null) {
    sections.push({
      id: "error",
      label: "Error",
      text: params.errorText,
      tone: "danger"
    });
  }

  const shouldHideRawResultForShellLikeTool =
    (params.toolName === "run_shell" || params.toolName === "computer_local_shell")
    && (params.stdout !== null || params.stderr !== null || params.functionOutputStdout !== null || params.functionOutputStderr !== null);

  if (params.rawFunctionOutput !== null && !shouldHideRawResultForShellLikeTool) {
    sections.push({
      id: "result",
      label: "Result",
      text: formatMaybeJson(params.rawFunctionOutput, params.parsedFunctionOutput),
      tone: "neutral"
    });
  }

  if (params.rawCustomOutput !== null) {
    sections.push({
      id: "custom-result",
      label: "Result",
      text: params.rawCustomOutput,
      tone: params.errorText !== null ? "danger" : "neutral"
    });
  }

  if (params.rawApplyPatchOutput !== null && params.stdout === null) {
    sections.push({
      id: "apply-patch-result",
      label: "Result",
      text: params.rawApplyPatchOutput,
      tone: params.errorText !== null ? "danger" : "neutral"
    });
  }

  if (params.webSearchCall !== null) {
    sections.push({
      id: "web-search-status",
      label: params.webSearchStatus === "failed" ? "Error" : "Status",
      text: formatWebSearchStatus(params.webSearchStatus),
      tone: params.webSearchStatus === "failed" ? "danger" : "neutral",
      defaultExpanded: true
    });
  }

  return sections;
}

function buildToolMetadataSections(payload: Record<string, unknown>, sectionCount: number): ToolSection[] {
  const extraPayloadEntries = Object.entries(payload).filter(([key]) => !HIDDEN_TOOL_PAYLOAD_KEYS.has(key));
  if (extraPayloadEntries.length > 0) {
    const metadataPayload: Record<string, unknown> = {};
    for (const [key, value] of extraPayloadEntries) {
      metadataPayload[key] = value;
    }

    return [{
      id: "metadata",
      label: "Metadata",
      text: JSON.stringify(metadataPayload, null, 2),
      tone: "neutral"
    }];
  }

  if (sectionCount === 0) {
    return [{
      id: "raw",
      label: "Payload",
      text: JSON.stringify(payload, null, 2),
      tone: "neutral"
    }];
  }

  return [];
}

function buildFromMessage(message: TaskMessage): ParsedToolDisplay {
  const payload = message.content_json;
  const functionCall = isRecord(payload.response_function_call) ? payload.response_function_call : null;
  const functionOutput = isRecord(payload.response_function_output) ? payload.response_function_output : null;
  const customToolCall = isRecord(payload.response_custom_tool_call) ? payload.response_custom_tool_call : null;
  const customToolOutput = isRecord(payload.response_custom_tool_output) ? payload.response_custom_tool_output : null;
  const applyPatchCall = isRecord(payload.response_apply_patch_call) ? payload.response_apply_patch_call : null;
  const applyPatchOutput = isRecord(payload.response_apply_patch_output) ? payload.response_apply_patch_output : null;
  const webSearchCall = isRecord(payload.response_web_search_call) ? payload.response_web_search_call : null;

  const rawArguments = asString(functionCall?.arguments);
  const parsedArguments = parseMaybeJson(rawArguments);
  const rawFunctionOutput = asString(functionOutput?.output);
  const parsedFunctionOutput = parseMaybeJson(rawFunctionOutput);
  const parsedFunctionOutputRecord = isRecord(parsedFunctionOutput) ? parsedFunctionOutput : null;

  const customOutputValue = customToolOutput?.output;
  const rawCustomOutput =
    typeof customOutputValue === "string"
      ? customOutputValue
      : customOutputValue !== undefined
        ? JSON.stringify(customOutputValue, null, 2)
        : null;

  const rawApplyPatchInput = applyPatchCall
    ? typeof applyPatchCall.operation === "object"
      ? JSON.stringify(applyPatchCall.operation, null, 2)
      : asString(applyPatchCall.input)
    : null;

  const toolName = asString(functionCall?.name) ?? asString(customToolCall?.name) ?? asString(payload.tool) ?? "tool";
  const webSearchStatus = asString(webSearchCall?.status);
  const callId =
    asString(functionCall?.call_id)
    ?? asString(functionOutput?.call_id)
    ?? asString(customToolCall?.call_id)
    ?? asString(customToolOutput?.call_id)
    ?? asString(applyPatchCall?.call_id)
    ?? asString(applyPatchOutput?.call_id)
    ?? asString(payload.callId)
    ?? asString(webSearchCall?.id);

  const command = asString(payload.command) ?? (isRecord(parsedArguments) ? asString(parsedArguments.command) : null);
  const errorText = asString(payload.error) ?? asString(parsedFunctionOutputRecord?.error);
  const interrupted = asBoolean(payload.interrupted) ?? asBoolean(parsedFunctionOutputRecord?.interrupted) ?? false;

  const inputSections = buildToolInputSections({
    command,
    inputText: asString(payload.inputText),
    inputLabel: asString(payload.inputLabel),
    rawCustomInput: asString(customToolCall?.input),
    rawApplyPatchInput,
    rawArguments,
    parsedArguments,
    responseArgument: extractResponseArgument(parsedArguments)
  });

  const outputSections = buildToolOutputSections({
    toolName,
    stdout: asString(payload.stdout),
    stderr: asString(payload.stderr),
    errorText,
    rawFunctionOutput,
    parsedFunctionOutput,
    functionOutputStdout: asString(parsedFunctionOutputRecord?.stdout),
    functionOutputStderr: asString(parsedFunctionOutputRecord?.stderr),
    rawCustomOutput,
    rawApplyPatchOutput: asString(applyPatchOutput?.output),
    webSearchCall,
    webSearchStatus
  });

  const primarySections = [...inputSections, ...outputSections];
  const metadataSections = buildToolMetadataSections(payload, primarySections.length);

  return {
    title: formatToolName(toolName),
    isContextManagementTool: CONTEXT_MANAGEMENT_TOOL_NAMES.has(toolName),
    status: webSearchStatus === "in_progress" || webSearchStatus === "searching"
      ? "running"
      : interrupted
        ? "interrupted"
        : "completed",
    callId,
    step: asNumber(payload.step),
    durationMs: asNumber(payload.durationMs) ?? asNumber(parsedFunctionOutputRecord?.durationMs),
    exitCode: asNumber(payload.exitCode) ?? asNumber(parsedFunctionOutputRecord?.exitCode),
    timedOut: asBoolean(payload.timedOut) ?? asBoolean(parsedFunctionOutputRecord?.timedOut) ?? false,
    sections: [...primarySections, ...metadataSections]
  };
}

function buildToolDisplay(props: ToolOutputProps): ParsedToolDisplay {
  if (props.liveCall) {
    return buildFromLiveCall(props.liveCall);
  }

  return buildFromMessage(props.message);
}

function ToolTextSection({ id, label, text, tone, defaultExpanded = false }: ToolSection) {
  const content = (id === "stdout" || id === "stderr" ? stripAnsi(text) : text).trimEnd();
  const lineCount = content.length === 0 ? 1 : content.split("\n").length;
  const isLong = lineCount > 10 || content.length > 600;
  const [isExpanded, setIsExpanded] = useState(!isLong || defaultExpanded);
  const isCollapsed = isLong && !isExpanded;

  return (
    <section className={`tool-section ${tone}`}>
      <div className="tool-section-header">
        <span className="tool-section-label">{label}</span>
        {isLong ? (
          <button type="button" className="tool-section-toggle" onClick={() => setIsExpanded((current) => !current)}>
            {isExpanded ? "Show less" : "Read more"}
          </button>
        ) : null}
      </div>
      <div className={`tool-code-shell${isCollapsed ? " collapsed" : ""}`}>
        <pre>{content.length > 0 ? content : "(empty)"}</pre>
        {isCollapsed ? <div className="tool-code-fade" aria-hidden="true" /> : null}
      </div>
    </section>
  );
}

export function ToolOutput(props: ToolOutputProps) {
  const display = buildToolDisplay(props);
  const [internalIsOpen, setInternalIsOpen] = useState(props.defaultOpen ?? false);
  const isOpen = props.open ?? internalIsOpen;
  const isRunning = display.status === "running";
  const isInterrupted = display.status === "interrupted";
  const canInterrupt =
    props.liveCall !== undefined &&
    props.liveCall.interruptible &&
    props.liveCall.step !== null &&
    typeof props.onInterruptRequested === "function";

  function handleOpenChange(nextOpen: boolean): void {
    if (props.open === undefined) {
      setInternalIsOpen(nextOpen);
    }
    props.onOpenChange?.(nextOpen);
  }

  return (
    <article className={`tool-call-card${display.isContextManagementTool ? " context-management" : ""}${isRunning ? " running" : ""}`}>
      <div className="tool-call-header">
        <button
          type="button"
          className="tool-call-toggle"
          onClick={() => handleOpenChange(!isOpen)}
        >
          <span className="tool-call-top-row">
            <span className="tool-call-title-wrap">
              <span className="tool-call-title">{display.title}</span>
              <span className={`tool-call-status-badge ${display.status}`}>
                {isRunning ? "Running" : isInterrupted ? "Interrupted" : "Completed"}
              </span>
            </span>
          </span>
          <span className="tool-call-bottom-row">
            <span className="tool-call-meta-chips">
              {display.step !== null ? <span className="tool-chip">step {display.step}</span> : null}
              {display.exitCode !== null ? (
                <span className={`tool-chip ${display.exitCode === 0 ? "good" : "danger"}`}>exit {display.exitCode}</span>
              ) : null}
              {display.timedOut ? <span className="tool-chip danger">timed out</span> : null}
              {isInterrupted ? <span className="tool-chip danger">interrupted</span> : null}
              {display.durationMs !== null ? <span className="tool-chip">{formatDuration(display.durationMs)}</span> : null}
            </span>
            <span className="tool-call-chevron" aria-hidden="true">
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </span>
        </button>
        {canInterrupt && props.liveCall ? (
          <button
            type="button"
            className="tool-interrupt-btn"
            onClick={() => props.onInterruptRequested?.(props.liveCall)}
            disabled={props.interruptPending}
            title={props.interruptPending ? "Interrupt requested" : "Interrupt this command"}
          >
            <Square size={16} />
          </button>
        ) : null}
      </div>
      {isOpen ? (
        <div className="tool-call-body">
          {display.sections.map((section) => (
            <ToolTextSection key={section.id} {...section} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
