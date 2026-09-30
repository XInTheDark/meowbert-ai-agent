/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingIndicator } from "./LoadingIndicator";

describe("LoadingIndicator", () => {
  it("renders nothing until the show delay elapses", () => {
    expect(renderToStaticMarkup(<LoadingIndicator />)).toBe("");
  });

  it("renders immediately when the delay is disabled", () => {
    const html = renderToStaticMarkup(<LoadingIndicator delayMs={0} />);

    expect(html).toContain("loading-indicator-spinner");
    expect(html).toContain("loading-indicator-arc");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading"');
  });

  it("uses the label for both the caption and the accessible name", () => {
    const html = renderToStaticMarkup(<LoadingIndicator delayMs={0} label="Loading tasks" />);

    expect(html).toContain('aria-label="Loading tasks"');
    expect(html).toContain("loading-indicator-label");
    expect(html).toContain("Loading tasks");
  });

  it("hides the decorative svg from assistive technology", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<LoadingIndicator delayMs={0} label="Loading tasks" />);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("applies the centred layout and the requested size", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<LoadingIndicator delayMs={0} center size={24} />);

    expect(container.querySelector(".loading-indicator")?.className).toContain("loading-indicator-center");
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("24");
  });
});
