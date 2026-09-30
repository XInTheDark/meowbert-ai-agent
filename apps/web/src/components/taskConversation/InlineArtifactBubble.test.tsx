/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { InlineArtifactBubble } from "./InlineArtifactBubble";

describe("InlineArtifactBubble", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it("commits zoom after the drag ends", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <InlineArtifactBubble
          messageId="message-1"
          src="https://example.test/reports/summary.html"
          artifact={{
            type: "html",
            relativePath: "reports/summary.html",
            title: "Summary",
            description: "Artifact preview",
            width: 760,
            height: 540
          }}
        />
      );
    });

    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    const frame = container.querySelector<HTMLIFrameElement>("iframe.inline-artifact-frame");
    const output = container.querySelector<HTMLOutputElement>(".inline-artifact-scale-label");
    const loadingStatus = container.querySelector<HTMLElement>(".inline-artifact-preview-status");
    const bubble = container.querySelector<HTMLElement>(".inline-artifact-bubble");

    expect(slider).not.toBeNull();
    expect(frame?.style.height).toBe("540px");
    expect(output?.textContent).toBe("100%");
    expect(loadingStatus?.textContent).toBe("Loading html preview...");
    expect(bubble?.style.getPropertyValue("--inline-artifact-preview-width")).toBe("760px");

    await act(async () => {
      slider?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(slider, "1.5");
      slider?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(frame?.style.height).toBe("540px");
    expect(output?.textContent).toBe("150%");

    await act(async () => {
      slider?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(frame?.style.height).toBe("810px");
    expect(output?.textContent).toBe("150%");
    expect(bubble?.style.getPropertyValue("--inline-artifact-preview-width")).toBe("1140px");

    await act(async () => {
      frame?.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(container.querySelector(".inline-artifact-preview-status")).toBeNull();
  });
});
