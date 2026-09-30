/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectedTextQuoteCard } from "./SelectedTextQuoteCard";

describe("SelectedTextQuoteCard", () => {
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

  it("renders quote snippet, location, and handles remove callback", async () => {
    const onRemove = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <SelectedTextQuoteCard
          quote={{
            text: "const sample = true;",
            location: "line 1:1 to line 1:20"
          }}
          onRemove={onRemove}
        />
      );
    });

    expect(container.querySelector("blockquote")?.textContent).toBe("const sample = true;");
    expect(container.querySelector("figcaption")?.textContent).toBe("line 1:1 to line 1:20");
    expect(container.querySelector(".selected-text-quote-comment")).toBeNull();

    const removeBtn = container.querySelector<HTMLButtonElement>(".selected-text-quote-remove");
    expect(removeBtn).toBeTruthy();

    await act(async () => {
      removeBtn?.click();
    });

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders annotation layout with index badge, comment, and excerpt when comment is present", async () => {
    const onRemove = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <SelectedTextQuoteCard
          quote={{
            text: "fetch internal artifact links",
            location: "line 10:1 to line 10:30",
            comment: "yes, so you should do this"
          }}
          index={3}
          onRemove={onRemove}
        />
      );
    });

    expect(container.querySelector(".selected-text-annotation-badge")?.textContent).toBe("3");
    expect(container.querySelector(".selected-text-annotation-title")?.textContent).toBe("Annotation 3");
    expect(container.querySelector(".selected-text-annotation-comment")?.textContent).toBe("yes, so you should do this");
    expect(container.querySelector(".selected-text-annotation-excerpt blockquote")?.textContent).toBe("fetch internal artifact links");
    expect(container.querySelector("figcaption")?.textContent).toBe("line 10:1 to line 10:30");

    const removeBtn = container.querySelector<HTMLButtonElement>(".selected-text-quote-remove");
    expect(removeBtn).toBeTruthy();
    await act(async () => {
      removeBtn?.click();
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

});
