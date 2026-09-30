/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useToolInspectorScroll } from "./useToolInspectorScroll";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestHarnessState {
  handleScroll: () => void;
}

interface TestComponentProps {
  groupKey: string | null;
  itemCount: number;
  contentVersion?: unknown;
  onControlsReady?: (controls: TestHarnessState) => void;
}

function TestComponent(props: TestComponentProps): JSX.Element {
  const scroll = useToolInspectorScroll({
    groupKey: props.groupKey,
    itemCount: props.itemCount,
    contentVersion: props.contentVersion
  });

  props.onControlsReady?.({
    handleScroll: scroll.handleScroll
  });

  return (
    <div
      ref={scroll.bodyRef}
      className="test-scroll-body"
      onScroll={scroll.handleScroll}
      style={{ height: "400px", overflow: "auto" }}
    >
      <div style={{ height: `${props.itemCount * 300}px` }}>content</div>
    </div>
  );
}

describe("useToolInspectorScroll", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("resets scroll to top when groupKey changes", async () => {
    await act(async () => {
      root?.render(<TestComponent groupKey="group-1" itemCount={2} />);
      await Promise.resolve();
    });

    const el = document.body.querySelector<HTMLDivElement>(".test-scroll-body");
    expect(el).not.toBeNull();
    if (!el) {
      throw new Error("Element not found");
    }

    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    el.scrollTop = 300;

    await act(async () => {
      root?.render(<TestComponent groupKey="group-2" itemCount={3} />);
      await Promise.resolve();
    });

    expect(el.scrollTop).toBe(0);
  });

  it("preserves scroll position when user scrolled up (isNearBottom is false)", async () => {
    let controls: TestHarnessState | null = null;

    await act(async () => {
      root?.render(
        <TestComponent
          groupKey="group-1"
          itemCount={2}
          onControlsReady={(readyControls) => {
            controls = readyControls;
          }}
        />
      );
      await Promise.resolve();
    });

    const el = document.body.querySelector<HTMLDivElement>(".test-scroll-body");
    expect(el).not.toBeNull();
    if (!el) {
      throw new Error("Element not found");
    }

    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    el.scrollTop = 200; // Far from bottom (1000 - 200 - 400 = 400px > 48px)

    // Trigger scroll event to update near bottom state
    await act(async () => {
      controls?.handleScroll();
    });

    // Render new item in same groupKey
    Object.defineProperty(el, "scrollHeight", { value: 1400, configurable: true });
    await act(async () => {
      root?.render(
        <TestComponent
          groupKey="group-1"
          itemCount={3}
          onControlsReady={(readyControls) => {
            controls = readyControls;
          }}
        />
      );
      await Promise.resolve();
    });

    // Scroll should NOT have jumped to bottom
    expect(el.scrollTop).toBe(200);
  });

  it("follows bottom when user is at bottom (isNearBottom is true)", async () => {
    let controls: TestHarnessState | null = null;

    await act(async () => {
      root?.render(
        <TestComponent
          groupKey="group-1"
          itemCount={2}
          onControlsReady={(readyControls) => {
            controls = readyControls;
          }}
        />
      );
      await Promise.resolve();
    });

    const el = document.body.querySelector<HTMLDivElement>(".test-scroll-body");
    expect(el).not.toBeNull();
    if (!el) {
      throw new Error("Element not found");
    }

    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    el.scrollTop = 580; // Near bottom (1000 - 580 - 400 = 20px <= 48px)

    await act(async () => {
      controls?.handleScroll();
    });

    // Render new item
    Object.defineProperty(el, "scrollHeight", { value: 1400, configurable: true });
    await act(async () => {
      root?.render(
        <TestComponent
          groupKey="group-1"
          itemCount={3}
          onControlsReady={(readyControls) => {
            controls = readyControls;
          }}
        />
      );
      await Promise.resolve();
    });

    // Should pin to bottom
    expect(el.scrollTop).toBe(1400);
  });
});
