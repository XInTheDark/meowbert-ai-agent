import {
  CANVAS_FRAME_MESSAGE_SOURCE,
  CANVAS_FRAME_NAME_PREFIX,
  CANVAS_FRAME_SANDBOX
} from "./canvas-frame-runtime.mjs";

export { CANVAS_FRAME_MESSAGE_SOURCE, CANVAS_FRAME_NAME_PREFIX, CANVAS_FRAME_SANDBOX };

export type CanvasFrameErrorKind = "script" | "resource" | "promise" | "security" | "console" | "network";

export interface CanvasFrameError {
  kind: CanvasFrameErrorKind;
  message: string;
  source: string | null;
  line: number | null;
}

export interface CanvasFrameTheme {
  mode: "light" | "dark";
  tokens: Record<string, string>;
}

export interface CanvasElementSelection {
  tagName: string;
  selector: string;
  text: string;
  attributes: Record<string, string>;
  screenLabel: string | null;
}

/** State the parent hands the frame through the iframe name, readable before page scripts run. */
export interface CanvasFrameInit {
  theme: CanvasFrameTheme | null;
  storage: { local?: Record<string, string> };
}

export type CanvasFrameMessage =
  | { type: "hello" }
  | { type: "ready" | "content"; blank: boolean; title: string | null }
  | { type: "resize"; height: number }
  | { type: "error"; error: CanvasFrameError }
  | { type: "storage"; area: "local"; items: Record<string, string> }
  | { type: "selection"; element: CanvasElementSelection | null }
  | { type: "run"; prompt: string; title: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function parseFrameError(value: unknown): CanvasFrameError | null {
  if (!isRecord(value) || typeof value.message !== "string") return null;
  const kinds: CanvasFrameErrorKind[] = ["script", "resource", "promise", "security", "console", "network"];
  return {
    kind: kinds.includes(value.kind as CanvasFrameErrorKind) ? value.kind as CanvasFrameErrorKind : "script",
    message: value.message.slice(0, 1000),
    source: typeof value.source === "string" ? value.source.slice(0, 1000) : null,
    line: typeof value.line === "number" && Number.isFinite(value.line) ? value.line : null
  };
}

function parseElementSelection(value: unknown): CanvasElementSelection | null {
  if (!isRecord(value) || typeof value.tagName !== "string" || typeof value.selector !== "string") return null;
  const allowedAttributes = new Set(["id", "class", "role", "aria-label", "alt", "title", "data-meowbert-id"]);
  const attributes = Object.fromEntries(Object.entries(asStringRecord(value.attributes))
    .filter(([key]) => allowedAttributes.has(key)).map(([key, text]) => [key, text.slice(0, 300)]));
  return {
    tagName: value.tagName.slice(0, 40),
    selector: value.selector.slice(0, 1200),
    text: typeof value.text === "string" ? value.text.slice(0, 1500) : "",
    attributes,
    screenLabel: typeof value.screenLabel === "string" ? value.screenLabel.slice(0, 200) : null
  };
}

/** Validates a message posted by the canvas runtime; anything else from the frame is ignored. */
export function parseCanvasFrameMessage(data: unknown): CanvasFrameMessage | null {
  if (!isRecord(data) || data.source !== CANVAS_FRAME_MESSAGE_SOURCE) return null;
  switch (data.type) {
    case "hello":
      return { type: "hello" };
    case "ready":
    case "content":
      return { type: data.type, blank: data.blank === true, title: typeof data.title === "string" ? data.title : null };
    case "resize":
      return typeof data.height === "number" && Number.isFinite(data.height) && data.height >= 0
        ? { type: "resize", height: data.height }
        : null;
    case "error": {
      const error = parseFrameError(data.error);
      return error ? { type: "error", error } : null;
    }
    case "storage":
      return data.area === "local" ? { type: "storage", area: "local", items: asStringRecord(data.items) } : null;
    case "selection": {
      const element = data.element === null ? null : parseElementSelection(data.element);
      return element || data.element === null ? { type: "selection", element } : null;
    }
    case "run":
      return typeof data.prompt === "string" && data.prompt.trim().length > 0
        ? { type: "run", prompt: data.prompt.trim().slice(0, 8000), title: typeof data.title === "string" ? data.title : null }
        : null;
    default:
      return null;
  }
}

export function buildCanvasFrameName(init: CanvasFrameInit): string {
  return `${CANVAS_FRAME_NAME_PREFIX}${JSON.stringify(init)}`;
}
