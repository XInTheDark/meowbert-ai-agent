/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AttachFilesMenu } from "./AttachFilesMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("portals the compact menu, accepts its actions, and dismisses outside clicks", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onCreate = vi.fn();
  try {
    act(() => root.render(<AttachFilesMenu variant="button" onCreateTextFile={onCreate} />));
    const trigger = container.querySelector("button")!;
    act(() => trigger.click());
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.parentElement).toBe(document.body);
    const action = menu.querySelector("button")!;
    act(() => action.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.body.contains(action)).toBe(true);
    act(() => action.click());
    expect(onCreate).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    act(() => trigger.click());
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
