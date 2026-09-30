/** @vitest-environment jsdom */

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  getClippingContainerBounds,
  useChatToolsDropdownPlacement,
  type ChatToolsDropdownPlacementOptions,
  type ChatToolsDropdownPlacementResult
} from "./useChatToolsDropdownPlacement";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function HookHarness(props: {
  options: Omit<ChatToolsDropdownPlacementOptions, "triggerRef" | "popoverRef">;
  trigger: HTMLElement;
  popover?: HTMLDivElement | null;
  onResult: (result: ChatToolsDropdownPlacementResult) => void;
}) {
  const triggerRef = useRef<HTMLElement | null>(props.trigger);
  const popoverRef = useRef<HTMLDivElement | null>(props.popover ?? null);
  const result = useChatToolsDropdownPlacement({
    ...props.options,
    triggerRef,
    popoverRef
  });
  props.onResult(result);
  return null;
}

describe("getClippingContainerBounds", () => {
  it("defaults to window dimensions when no scrollable ancestors exist", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    try {
      const bounds = getClippingContainerBounds(el);
      expect(bounds.top).toBe(0);
      expect(bounds.bottom).toBe(window.innerHeight);
      expect(bounds.left).toBe(0);
      expect(bounds.right).toBe(window.innerWidth);
    } finally {
      el.remove();
    }
  });

  it("detects scrollable parent bounds", () => {
    const parent = document.createElement("div");
    parent.style.overflowY = "auto";
    parent.style.overflowX = "auto";
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 600,
      left: 50,
      right: 400,
      width: 350,
      height: 500,
      x: 50,
      y: 100,
      toJSON: () => {}
    });

    const el = document.createElement("div");
    parent.appendChild(el);
    document.body.appendChild(parent);

    try {
      const bounds = getClippingContainerBounds(el);
      expect(bounds.top).toBe(100);
      expect(bounds.bottom).toBe(600);
      expect(bounds.left).toBe(50);
      expect(bounds.right).toBe(400);
    } finally {
      parent.remove();
    }
  });
});

describe("useChatToolsDropdownPlacement", () => {
  it("applies bottom placement style when placement is explicitly bottom", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const trigger = document.createElement("button");
    let result!: ChatToolsDropdownPlacementResult;

    try {
      await act(async () => {
        root.render(
          <HookHarness
            trigger={trigger}
            options={{ isOpen: true, placement: "bottom" }}
            onResult={(r) => {
              result = r;
            }}
          />
        );
      });

      expect(result.popoverClassName).toBe("placement-bottom");
      expect(result.popoverStyle?.top).toBe("calc(100% + 0.35rem)");
      expect(result.popoverStyle?.bottom).toBe("auto");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("applies top placement style when placement is explicitly top", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const trigger = document.createElement("button");
    let result!: ChatToolsDropdownPlacementResult;

    try {
      await act(async () => {
        root.render(
          <HookHarness
            trigger={trigger}
            options={{ isOpen: true, placement: "top" }}
            onResult={(r) => {
              result = r;
            }}
          />
        );
      });

      expect(result.popoverClassName).toBe("placement-top");
      expect(result.popoverStyle?.bottom).toBe("calc(100% + 0.35rem)");
      expect(result.popoverStyle?.top).toBe("auto");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("defaults to bottom placement when variant is button", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const trigger = document.createElement("button");
    let result!: ChatToolsDropdownPlacementResult;

    try {
      await act(async () => {
        root.render(
          <HookHarness
            trigger={trigger}
            options={{ isOpen: true, variant: "button" }}
            onResult={(r) => {
              result = r;
            }}
          />
        );
      });

      expect(result.popoverClassName).toBe("placement-bottom");
      expect(result.popoverStyle?.top).toBe("calc(100% + 0.35rem)");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("auto-detects bottom direction when space above is restricted", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const parent = document.createElement("div");
    parent.style.overflowY = "auto";
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      top: 50,
      bottom: 800,
      left: 0,
      right: 400,
      width: 400,
      height: 750,
      x: 0,
      y: 50,
      toJSON: () => {}
    });

    const trigger = document.createElement("button");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 120,
      bottom: 152,
      left: 20,
      right: 52,
      width: 32,
      height: 32,
      x: 20,
      y: 120,
      toJSON: () => {}
    });

    parent.appendChild(trigger);
    document.body.appendChild(parent);
    let result!: ChatToolsDropdownPlacementResult;

    try {
      await act(async () => {
        root.render(
          <HookHarness
            trigger={trigger}
            options={{ isOpen: true, placement: "auto" }}
            onResult={(r) => {
              result = r;
            }}
          />
        );
      });

      expect(result.popoverClassName).toBe("placement-bottom");
      expect(result.popoverStyle?.top).toBe("calc(100% + 0.35rem)");
      expect(result.popoverStyle?.bottom).toBe("auto");
    } finally {
      act(() => root.unmount());
      container.remove();
      parent.remove();
    }
  });

  it("auto-detects top direction when space below is restricted", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const parent = document.createElement("div");
    parent.style.overflowY = "auto";
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 400,
      width: 400,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => {}
    });

    const trigger = document.createElement("button");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 750,
      bottom: 782,
      left: 20,
      right: 52,
      width: 32,
      height: 32,
      x: 20,
      y: 750,
      toJSON: () => {}
    });

    parent.appendChild(trigger);
    document.body.appendChild(parent);
    let result!: ChatToolsDropdownPlacementResult;

    try {
      await act(async () => {
        root.render(
          <HookHarness
            trigger={trigger}
            options={{ isOpen: true, placement: "auto" }}
            onResult={(r) => {
              result = r;
            }}
          />
        );
      });

      expect(result.popoverClassName).toBe("placement-top");
      expect(result.popoverStyle?.bottom).toBe("calc(100% + 0.35rem)");
      expect(result.popoverStyle?.top).toBe("auto");
    } finally {
      act(() => root.unmount());
      container.remove();
      parent.remove();
    }
  });

  it("shifts left when popover would overflow container right edge", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const parent = document.createElement("div");
    parent.style.overflowX = "auto";
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 320,
      width: 320,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => {}
    });

    const trigger = document.createElement("button");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 132,
      left: 150,
      right: 182,
      width: 32,
      height: 32,
      x: 150,
      y: 100,
      toJSON: () => {}
    });

    const popover = document.createElement("div");
    Object.defineProperty(popover, "offsetWidth", { configurable: true, get: () => 280 });

    parent.appendChild(trigger);
    document.body.appendChild(parent);
    let result!: ChatToolsDropdownPlacementResult;

    try {
      await act(async () => {
        root.render(
          <HookHarness
            trigger={trigger}
            popover={popover}
            options={{ isOpen: true, placement: "bottom" }}
            onResult={(r) => {
              result = r;
            }}
          />
        );
      });

      expect(result.popoverStyle?.left).toBe("-118px");
    } finally {
      act(() => root.unmount());
      container.remove();
      parent.remove();
    }
  });

  it("supports top-end and bottom-end placement alignments", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const trigger = document.createElement("button");
    let result!: ChatToolsDropdownPlacementResult;

    try {
      await act(async () => {
        root.render(
          <HookHarness
            trigger={trigger}
            options={{ isOpen: true, placement: "bottom-end" }}
            onResult={(r) => {
              result = r;
            }}
          />
        );
      });

      expect(result.popoverStyle?.left).toBe("auto");
      expect(result.popoverStyle?.right).toBe(0);
      expect(result.popoverClassName).toBe("placement-bottom");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("constrains popover maxHeight to available container bounds", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const parent = document.createElement("div");
    parent.style.overflowY = "auto";
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      top: 50,
      bottom: 220,
      left: 0,
      right: 400,
      width: 400,
      height: 170,
      x: 0,
      y: 50,
      toJSON: () => {}
    });

    const trigger = document.createElement("button");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 140,
      left: 20,
      right: 60,
      width: 40,
      height: 40,
      x: 20,
      y: 100,
      toJSON: () => {}
    });
    parent.appendChild(trigger);
    container.appendChild(parent);

    let result!: ChatToolsDropdownPlacementResult;

    try {
      await act(async () => {
        root.render(
          <HookHarness
            trigger={trigger}
            options={{ isOpen: true, placement: "bottom" }}
            onResult={(r) => {
              result = r;
            }}
          />
        );
      });

      expect(result.popoverStyle?.maxHeight).toBe("68px");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("caps popover maxHeight at PREFERRED_MAX_POPOVER_HEIGHT_PX when container has ample space", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const trigger = document.createElement("button");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 140,
      left: 20,
      right: 60,
      width: 40,
      height: 40,
      x: 20,
      y: 100,
      toJSON: () => {}
    });
    container.appendChild(trigger);

    let result!: ChatToolsDropdownPlacementResult;

    try {
      await act(async () => {
        root.render(
          <HookHarness
            trigger={trigger}
            options={{ isOpen: true, placement: "bottom" }}
            onResult={(r) => {
              result = r;
            }}
          />
        );
      });

      // innerHeight defaults to 768 in jsdom, 768 - 140 - 12 = 616px > 440px
      expect(result.popoverStyle?.maxHeight).toBe("440px");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
