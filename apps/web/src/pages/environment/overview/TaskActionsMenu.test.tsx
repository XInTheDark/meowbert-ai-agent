/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskActionsMenu } from "./TaskActionsMenu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TaskActionsMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll(".task-actions-dropdown-portal").forEach((element) => element.remove());
  });

  it("portals the open menu outside its clipping table container", () => {
    act(() => {
      root.render(
        <TaskActionsMenu open title="Actions" onToggle={vi.fn()}>
          <button type="button">Open</button>
        </TaskActionsMenu>
      );
    });

    const anchor = container.querySelector(".task-actions-menu-trigger");
    const menu = document.body.querySelector(".task-actions-dropdown-portal");

    expect(anchor).not.toBeNull();
    expect(menu?.parentElement).toBe(document.body);
    expect(anchor?.contains(menu)).toBe(false);
    expect(menu?.textContent).toContain("Open");
  });
});
