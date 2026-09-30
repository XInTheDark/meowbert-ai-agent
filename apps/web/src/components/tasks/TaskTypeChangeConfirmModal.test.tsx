/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskTypeChangeConfirmModal } from "./TaskTypeChangeConfirmModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function click(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("TaskTypeChangeConfirmModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders the warning text with target task type label", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    await act(async () => {
      root.render(
        <TaskTypeChangeConfirmModal
          targetTypeLabel="Agent Swarm"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      );
    });

    const modal = document.body.querySelector(".task-type-change-dialog");
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain("Changing the task type to Agent Swarm may cause some workflow progress to be lost.");
  });

  it("calls onCancel when Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    await act(async () => {
      root.render(
        <TaskTypeChangeConfirmModal
          targetTypeLabel="Standard task"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      );
    });

    const cancelButton = document.body.querySelector(".btn.ghost");
    await act(async () => click(cancelButton));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm when Change task type button is clicked", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    await act(async () => {
      root.render(
        <TaskTypeChangeConfirmModal
          targetTypeLabel="Long Horizon"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      );
    });

    const confirmButton = document.body.querySelector(".btn.primary");
    await act(async () => click(confirmButton));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
