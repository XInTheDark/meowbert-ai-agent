/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FileContextMenu } from "./FileContextMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("portals outside clipping ancestors and keeps the menu within the viewport on resize", () => {
  const container = document.createElement("div");
  container.style.overflow = "hidden";
  document.body.appendChild(container);
  const root = createRoot(container);
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 190, height: 150
  } as DOMRect);
  const onClick = vi.fn();
  try {
    act(() => root.render(<FileContextMenu x={window.innerWidth} y={window.innerHeight}><button onClick={onClick}>Remove</button></FileContextMenu>));
    const menu = document.querySelector<HTMLElement>(".file-context-menu")!;
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe(`${window.innerWidth - 198}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 158}px`);
    bounds.mockReturnValue({ width: 290, height: 250 } as DOMRect);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(menu.style.left).toBe(`${window.innerWidth - 298}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 258}px`);
    act(() => menu.querySelector("button")!.click());
    expect(onClick).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    bounds.mockRestore();
  }
});
