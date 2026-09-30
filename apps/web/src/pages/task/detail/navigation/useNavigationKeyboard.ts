import { useEffect, type KeyboardEvent, type RefObject } from "react";

export function useNavigationKeyboard(panel: RefObject<HTMLElement>, modal: boolean, close: () => void) {
  useEffect(() => {
    if (!modal || !panel.current) return;
    const element = panel.current;
    const prior = document.activeElement as HTMLElement | null;
    element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    const siblings = Array.from(element.parentElement?.children ?? [])
      .filter((item): item is HTMLElement => item instanceof HTMLElement && item !== element
        && !item.classList.contains("conversation-navigation-backdrop"));
    const previousInert = siblings.map((item) => item.inert);
    siblings.forEach((item) => { item.inert = true; });
    return () => {
      siblings.forEach((item, index) => { item.inert = previousInert[index]; });
      if (prior?.isConnected) prior.focus();
    };
  }, [panel, modal]);
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); return; }
    if (event.key !== "Tab" || !modal || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]'))
      .filter((item) => item.tabIndex >= 0 && !item.closest("[hidden]") && !item.matches(":disabled"));
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
}

export function handleNavigationTabKey(event: KeyboardEvent<HTMLButtonElement>, select: (index: number) => void) {
  const tabs = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const current = tabs.indexOf(event.currentTarget);
  const next = event.key === "ArrowRight" ? (current + 1) % tabs.length
    : event.key === "ArrowLeft" ? (current + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
  if (next === null) return;
  event.preventDefault(); select(next); tabs[next]?.focus();
}
