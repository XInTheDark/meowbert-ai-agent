/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AgentDropdown } from "./AgentDropdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentDropdown", () => {
  it("opens downwards when popoverPlacement is bottom", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      const onChange = vi.fn();
      await act(async () => {
        root.render(
          <AgentDropdown
            availableAgents={[
              { id: "luna-3", name: "Luna x3", description: "Fast model" },
              { id: "luna-4", name: "Luna x4", description: "Smart model" }
            ]}
            selectedAgentId="luna-3"
            onChange={onChange}
            popoverPlacement="bottom"
          />
        );
      });

      const trigger = container.querySelector("button")!;
      expect(trigger).toBeTruthy();

      await act(async () => {
        trigger.click();
      });

      const popover = container.querySelector('[role="menu"]')!;
      expect(popover).toBeTruthy();
      expect(popover.className).toContain("placement-bottom");
      expect((popover as HTMLElement).style.top).toBe("calc(100% + 0.35rem)");
      expect((popover as HTMLElement).style.bottom).toBe("auto");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("opens upwards by default when space above is abundant", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      const onChange = vi.fn();
      await act(async () => {
        root.render(
          <AgentDropdown
            availableAgents={[
              { id: "luna-3", name: "Luna x3", description: "Fast model" },
              { id: "luna-4", name: "Luna x4", description: "Smart model" }
            ]}
            selectedAgentId="luna-3"
            onChange={onChange}
          />
        );
      });

      const trigger = container.querySelector("button")!;
      const menu = container.querySelector(".chat-tools-menu")!;
      vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({
        top: 600,
        bottom: 632,
        left: 20,
        right: 52,
        width: 32,
        height: 32,
        x: 20,
        y: 600,
        toJSON: () => {}
      });

      await act(async () => {
        trigger.click();
      });

      const popover = container.querySelector('[role="menu"]')!;
      expect(popover).toBeTruthy();
      expect(popover.className).toContain("placement-top");
      expect((popover as HTMLElement).style.bottom).toBe("calc(100% + 0.35rem)");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("shows the admin slider first and keeps the full list available", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      const onChange = vi.fn();
      await act(async () => {
        root.render(
          <AgentDropdown
            availableAgents={[
              { id: "fast", name: "Fast", description: "Fast model" },
              { id: "default", name: "Default", description: "Default model" },
              { id: "deep", name: "Deep", description: "Deep model" }
            ]}
            modelSliderAgentIds={["deep", "default", "fast"]}
            selectedAgentId="default"
            onChange={onChange}
          />
        );
      });

      await act(async () => {
        container.querySelector("button")?.click();
      });

      expect(container.querySelector(".model-slider")).toBeTruthy();
      expect(container.textContent).toContain("Default");

      const slider = container.querySelector<HTMLInputElement>(".model-slider")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(slider, "0");
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(onChange).toHaveBeenLastCalledWith("deep");
      expect(container.querySelector(".model-slider")).toBeTruthy();

      await act(async () => {
        container.querySelector<HTMLButtonElement>(".chat-tools-link")?.click();
      });
      expect(container.querySelector(".model-slider")).toBeNull();
      expect(container.querySelectorAll('[role="menuitemradio"]').length).toBe(3);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("keeps a selected model visible when it is outside the configured slider", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      const onChange = vi.fn();
      await act(async () => {
        root.render(
          <AgentDropdown
            availableAgents={[
              { id: "custom", name: "Custom", description: "Custom model" },
              { id: "fast", name: "Fast", description: "Fast model" },
              { id: "deep", name: "Deep", description: "Deep model" }
            ]}
            modelSliderAgentIds={["fast", "deep"]}
            selectedAgentId="custom"
            onChange={onChange}
          />
        );
      });

      await act(async () => {
        container.querySelector("button")?.click();
      });

      expect(container.querySelector(".model-slider-current")?.textContent).toBe("Custom");
      const slider = container.querySelector<HTMLInputElement>(".model-slider")!;
      expect(slider.value).toBe("0");
      expect(slider.max).toBe("2");

      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(slider, "1");
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(onChange).toHaveBeenLastCalledWith("fast");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("keeps long configured sliders compact while retaining every model stop", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      const availableAgents = Array.from({ length: 13 }, (_, index) => ({
        id: `model-${index}`,
        name: `Model ${index}`,
        description: `Model ${index}`
      }));
      const onChange = vi.fn();
      await act(async () => {
        root.render(
          <AgentDropdown
            availableAgents={availableAgents}
            modelSliderAgentIds={availableAgents.map((agent) => agent.id)}
            selectedAgentId="model-11"
            onChange={onChange}
          />
        );
      });

      await act(async () => {
        container.querySelector("button")?.click();
      });

      expect(container.querySelectorAll(".model-slider-ticks span")).toHaveLength(5);
      const slider = container.querySelector<HTMLInputElement>(".model-slider")!;
      expect(slider.max).toBe("12");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(slider, "12");
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(onChange).toHaveBeenLastCalledWith("model-12");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
