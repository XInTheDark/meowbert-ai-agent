import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  CANVAS_FRAME_MESSAGE_SOURCE,
  buildCanvasFrameName,
  parseCanvasFrameMessage,
  type CanvasFrameError,
  type CanvasElementSelection,
  type CanvasFrameMessage,
  type CanvasFrameTheme
} from "@meowbert/shared/canvas-frame";
import { readCanvasStorage, writeCanvasStorage } from "./canvasFrameStorage";
import { resolveCanvasDocumentPath } from "./canvasDocumentPath";

export type CanvasFrameStatus = "loading" | "ready" | "unreachable";

export interface CanvasRunRequest {
  prompt: string;
  title: string | null;
}

export interface CanvasFrameState {
  status: CanvasFrameStatus;
  blank: boolean;
  errors: CanvasFrameError[];
  height: number | null;
  runRequest: CanvasRunRequest | null;
}

const INITIAL_STATE: CanvasFrameState = { status: "loading", blank: false, errors: [], height: null, runRequest: null };

// State belongs to one load of the frame; a new load starts from the initial state at once,
// without waiting for an effect that could also wipe what a fast page already reported.
interface KeyedState {
  loadKey: string;
  hello: boolean;
  state: CanvasFrameState;
}

function stateFor(current: KeyedState, loadKey: string): KeyedState {
  return current.loadKey === loadKey ? current : { loadKey, hello: false, state: INITIAL_STATE };
}
// After the frame's load event, a page that never says hello did not load as HTML (an error
// response, a missing file); without a load event, give up after the overall timeout.
const HELLO_AFTER_LOAD_MS = 2500;
const LOAD_TIMEOUT_MS = 20_000;
const MAX_ERRORS = 20;
// Pages sized to the viewport (100vh plus a margin) grow every time the frame does.
const GROWTH_STREAK_LIMIT = 6;

function appendError(errors: CanvasFrameError[], error: CanvasFrameError): CanvasFrameError[] {
  if (errors.length >= MAX_ERRORS) return errors;
  const duplicate = errors.some((existing) => existing.message === error.message && existing.source === error.source);
  return duplicate ? errors : [...errors, error];
}

function useGrowthGuard(loadKey: string) {
  const guard = useRef({ height: 0, streak: 0, frozen: false });
  useEffect(() => {
    guard.current = { height: 0, streak: 0, frozen: false };
  }, [loadKey]);
  return useCallback((height: number): number | null => {
    const current = guard.current;
    if (current.frozen) return height < current.height ? height : null;
    current.streak = height > current.height && height - current.height <= 64 ? current.streak + 1 : 0;
    current.frozen = current.streak >= GROWTH_STREAK_LIMIT;
    current.height = height;
    return current.frozen ? null : height;
  }, []);
}

function markUnreachable(current: KeyedState): KeyedState {
  return current.state.status === "loading" ? { ...current, state: { ...current.state, status: "unreachable" } } : current;
}

function reduceMessage(state: CanvasFrameState, message: CanvasFrameMessage, acceptHeight: (height: number) => number | null): CanvasFrameState {
  switch (message.type) {
    case "ready":
      return { ...state, status: "ready", blank: message.blank };
    case "content":
      return { ...state, blank: message.blank };
    case "resize": {
      const height = acceptHeight(message.height);
      return height === null || height === state.height ? state : { ...state, height };
    }
    case "error":
      return { ...state, errors: appendError(state.errors, message.error) };
    case "run":
      return state.runRequest ? state : { ...state, runRequest: { prompt: message.prompt, title: message.title } };
    default:
      return state;
  }
}

/** Talks to the canvas runtime inside one iframe: load state, errors, height, storage and run requests. */
export function useCanvasFrameBridge(input: {
  frameRef: RefObject<HTMLIFrameElement>;
  loadKey: string;
  storageKey: string;
  viewKey: string;
  theme: CanvasFrameTheme;
  src: string;
  relativePath?: string;
  onDocumentPath?: (path: string) => void;
  selectionEnabled?: boolean;
  onElementSelect?: (element: CanvasElementSelection | null) => void;
  documentFit?: boolean;
  onDocumentKind?: (kind: import("@meowbert/shared/canvas-frame").CanvasDocumentKind) => void;
}) {
  const [keyed, setKeyed] = useState<KeyedState>({ loadKey: input.loadKey, hello: false, state: INITIAL_STATE });
  const loadKeyRef = useRef(input.loadKey);
  loadKeyRef.current = input.loadKey;
  const acceptHeight = useGrowthGuard(input.loadKey);
  const update = useCallback((change: (current: KeyedState) => KeyedState) => {
    setKeyed((current) => change(stateFor(current, loadKeyRef.current)));
  }, []);
  const initialTheme = useRef(input.theme);
  const initialFit = useRef(input.documentFit);
  const scrollPositions = useRef(new Map<string, { x: number; y: number }>());
  const scrollKey = `${input.storageKey}:${input.viewKey}`;
  initialTheme.current = input.theme;
  initialFit.current = input.documentFit;
  // Read once per load: changing an iframe's name later would overwrite what the page stored in it.
  const frameName = useMemo(
    () => buildCanvasFrameName({ theme: initialTheme.current, documentFit: initialFit.current !== false,
      storage: { local: readCanvasStorage(input.storageKey) }, scroll: scrollPositions.current.get(scrollKey) }),
    [input.loadKey, input.storageKey, scrollKey]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => update((current) => markUnreachable(current)), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [input.loadKey, update]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!input.frameRef.current || event.source !== input.frameRef.current.contentWindow) return;
      const message = parseCanvasFrameMessage(event.data);
      if (!message) return;
      if (message.type === "location") {
        const path = resolveCanvasDocumentPath(input.src, input.relativePath ?? "", message.href);
        if (path) input.onDocumentPath?.(path);
        return;
      }
      if (message.type === "scroll") {
        scrollPositions.current.set(scrollKey, { x: message.x, y: message.y });
        return;
      }
      if (message.type === "ready" || message.type === "content") input.onDocumentKind?.(message.kind);
      if (message.type === "selection") {
        if (input.selectionEnabled) input.onElementSelect?.(message.element);
        return;
      }
      if (message.type === "storage") writeCanvasStorage(input.storageKey, message.items);
      update((current) => ({
        ...current,
        hello: current.hello || message.type === "hello",
        state: reduceMessage(current.state, message, acceptHeight)
      }));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [acceptHeight, input.frameRef, input.src, input.relativePath, input.onDocumentPath, input.storageKey, input.selectionEnabled, input.onElementSelect, input.onDocumentKind, scrollKey, update]);

  useEffect(() => {
    input.frameRef.current?.contentWindow?.postMessage({
      source: CANVAS_FRAME_MESSAGE_SOURCE, type: "document-view", fit: input.documentFit !== false
    }, "*");
  }, [input.frameRef, input.loadKey, input.documentFit, keyed.hello, keyed.state.status]);

  useEffect(() => {
    input.frameRef.current?.contentWindow?.postMessage({
      source: CANVAS_FRAME_MESSAGE_SOURCE, type: "selection-mode", enabled: input.selectionEnabled === true
    }, "*");
  }, [input.frameRef, input.loadKey, input.selectionEnabled, keyed.loadKey, keyed.hello]);

  useEffect(() => {
    input.frameRef.current?.contentWindow?.postMessage({ source: CANVAS_FRAME_MESSAGE_SOURCE, type: "theme", theme: input.theme }, "*");
  }, [input.frameRef, input.theme]);

  const handleFrameLoad = useCallback(() => {
    const loadKey = loadKeyRef.current;
    window.setTimeout(() => {
      if (loadKeyRef.current !== loadKey) return;
      update((current) => current.hello ? current : markUnreachable(current));
    }, HELLO_AFTER_LOAD_MS);
  }, [update]);

  const dismissRunRequest = useCallback(() => update((current) => ({ ...current, state: { ...current.state, runRequest: null } })), [update]);

  return { state: stateFor(keyed, input.loadKey).state, frameName, handleFrameLoad, dismissRunRequest };
}
