// @vitest-environment jsdom

import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextCheckpointDialog } from "./ContextCheckpointDialog";

describe("ContextCheckpointDialog", () => {
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
  });

  it("displays the checkpoint description and closes on Escape", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <ContextCheckpointDialog
          checkpoint="Detailed goals, decisions, current state, and next steps."
          onClose={onClose}
        />
      );
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Context checkpoint");
    expect(dialog?.textContent).toContain("Detailed goals, decisions, current state, and next steps.");

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
