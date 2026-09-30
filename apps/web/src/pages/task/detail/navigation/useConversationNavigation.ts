import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConversationNavigation } from "@meowbert/shared/conversation-organization";
import type { ApiClient } from "../../../../lib/api";

export type NavigationView = "map" | "outline" | "list";
export function readNavigationPreference(key: string): string | null {
  try { return window.localStorage.getItem(`conversation-navigation:${key}`); } catch { return null; }
}
function savePreference(key: string, value: string): void {
  try { window.localStorage.setItem(`conversation-navigation:${key}`, value); } catch { /* Storage may be unavailable. */ }
}

function useNavigationView(taskId: string) {
  const [isOpen, setIsOpen] = useState(() => readNavigationPreference(`${taskId}:open`) === "true");
  const [view, setView] = useState<NavigationView>(() => (readNavigationPreference(`${taskId}:view`) as NavigationView) || "list");
  const lastMessagesView = useRef<NavigationView>((readNavigationPreference(`${taskId}:messagesView`) as NavigationView) || "list");
  useEffect(() => {
    lastMessagesView.current = (readNavigationPreference(`${taskId}:messagesView`) as NavigationView) || "list";
    setIsOpen(readNavigationPreference(`${taskId}:open`) === "true");
    setView((readNavigationPreference(`${taskId}:view`) as NavigationView) || "list");
  }, [taskId]);
  function selectView(next: NavigationView) {
    setView(next);
    if (next !== "outline") { lastMessagesView.current = next; savePreference(`${taskId}:messagesView`, next); }
    savePreference(`${taskId}:view`, next);
  }
  function close() { setIsOpen(false); savePreference(`${taskId}:open`, "false"); }
  function toggle(next: NavigationView) {
    if (isOpen && view === next) close();
    else { selectView(next); setIsOpen(true); savePreference(`${taskId}:open`, "true"); }
  }
  return { isOpen, setIsOpen, view, setView, selectView, close, toggle,
    setDefaultMessagesView: (next: NavigationView) => { lastMessagesView.current = next; setView(next); },
    toggleMessages: () => toggle(view === "outline" ? lastMessagesView.current : view) };
}

export function useConversationNavigation(input: {
  api: ApiClient; taskId: string; enabled: boolean; leafId: string | null; refreshKey: string;
}) {
  const pane = useNavigationView(input.taskId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [width, setWidthState] = useState(() => Math.min(800, Math.max(420, Number(readNavigationPreference("width")) || 520)));
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<ConversationNavigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setContainerWidth(element.clientWidth));
    observer.observe(element); setContainerWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [input.enabled]);
  useEffect(() => { setData(null); setError(null); setExpanded(false); }, [input.taskId, input.enabled]);
  useEffect(() => {
    if (!input.enabled) return;
    let cancelled = false;
    const params = input.leafId ? `?activeLeafMessageId=${encodeURIComponent(input.leafId)}` : "";
    const timer = window.setTimeout(() => {
      void input.api.get<ConversationNavigation>(`/api/tasks/${input.taskId}/conversation/navigation${params}`)
        .then((next) => { if (!cancelled) { setData(next); setError(null); } })
        .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to load navigation."); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [input.api, input.taskId, input.leafId, input.refreshKey, input.enabled, retry]);
  useEffect(() => {
    if (!data?.enabled || !input.enabled) return;
    if (!readNavigationPreference(`${input.taskId}:view`)) pane.setDefaultMessagesView(data.map ? "map" : "list");
    if (data.outline && containerWidth >= width + 640 && !readNavigationPreference(`${input.taskId}:revealed`)) {
      savePreference(`${input.taskId}:revealed`, "true");
      if (readNavigationPreference(`${input.taskId}:open`) === null) {
        pane.setView("outline"); pane.setIsOpen(true);
        savePreference(`${input.taskId}:view`, "outline"); savePreference(`${input.taskId}:open`, "true");
      }
    }
  }, [data, input.enabled, input.taskId, containerWidth, width]);
  function setWidth(value: number) {
    const next = Math.min(800, Math.max(420, value)); setWidthState(next); savePreference("width", String(next));
  }
  return { ...pane, data, error, retry: () => setRetry((value) => value + 1), enabled: input.enabled && data?.enabled !== false,
    containerRef, containerWidth, width, setWidth, expanded, setExpanded,
    close: () => { pane.close(); setExpanded(false); } };
}

export type ConversationNavigationController = ReturnType<typeof useConversationNavigation>;
