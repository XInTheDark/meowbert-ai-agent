/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmStopButton } from "./ConfirmStopButton";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ConfirmStopButton", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(runningSince: string | null, onStop: () => void): HTMLButtonElement {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(
      <ConfirmStopButton className="stop-btn" title="Stop task" runningSince={runningSince} onStop={onStop}>x</ConfirmStopButton>
    ));
    return container.querySelector("button")!;
  }

  it("stops a run under a minute old on the first click", () => {
    const onStop = vi.fn();
    const button = render(new Date(Date.now() - 10_000).toISOString(), onStop);
    act(() => button.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("needs a second click for a longer run, and a click elsewhere resets it", () => {
    const onStop = vi.fn();
    const button = render(new Date(Date.now() - 120_000).toISOString(), onStop);
    act(() => button.click());
    expect(onStop).not.toHaveBeenCalled();
    expect(button.className).toContain("stop-confirm-armed");

    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(button.className).not.toContain("stop-confirm-armed");
    act(() => button.click());
    expect(onStop).not.toHaveBeenCalled();

    act(() => button.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
