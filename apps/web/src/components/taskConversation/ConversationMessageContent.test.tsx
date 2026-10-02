/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultTaskAssistantMessageDisplayPreferences } from "../../task/taskPagePreferences";
import { ConversationMessageContent } from "./ConversationMessageContent";

function createLocalStorageMock() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  };
}

describe("ConversationMessageContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createLocalStorageMock()
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders safe common HTML tags and strips unsafe markup", () => {
    act(() => {
      root.render(
        <ConversationMessageContent
          content={'<details open><summary>More</summary>Body</details><script>alert("no")</script>'}
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("summary")?.textContent).toBe("More");
    expect(container.querySelector("script")).toBeNull();
  });

  it("leaves HTML markup inert when common HTML rendering is disabled", () => {
    act(() => {
      root.render(
        <ConversationMessageContent
          content="<details><summary>More</summary>Body</details>"
          displayPreferences={{
            ...buildDefaultTaskAssistantMessageDisplayPreferences(),
            renderCommonHtml: false
          }}
        />
      );
    });

    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).toContain("<details>");
  });

  it("hides citation codes in rendered and plain assistant text unless disabled", () => {
    const content = "Source. citeturn2view3turn2view0 Next.";
    const defaults = buildDefaultTaskAssistantMessageDisplayPreferences();

    act(() => root.render(<ConversationMessageContent content={content} displayPreferences={defaults} />));
    expect(container.textContent).toContain("Source. Next.");
    expect(container.textContent).not.toContain("turn2view3");

    act(() => root.render(<ConversationMessageContent content={content} displayPreferences={{ ...defaults, renderMarkdown: false }} />));
    expect(container.textContent).toContain("Source. Next.");

    act(() => root.render(<ConversationMessageContent content={content} displayPreferences={{ ...defaults, hideCitationMarkers: false }} />));
    expect(container.textContent).toContain("citeturn2view3turn2view0");
  });

  it("keeps Read more expanded after the message remounts", () => {
    const content = Array.from({ length: 26 }, (_, index) => `Line ${index + 1}`).join("\n");
    const props = {
      content,
      displayPreferences: buildDefaultTaskAssistantMessageDisplayPreferences(),
      enableLongMessageCollapse: true,
      expansionKey: "task-1:message-1"
    };

    act(() => root.render(<ConversationMessageContent {...props} />));
    const toggle = container.querySelector<HTMLButtonElement>(".bubble-collapsible-toggle");
    expect(toggle?.textContent).toBe("Read more");

    act(() => toggle?.click());
    expect(toggle?.textContent).toBe("Show less");

    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<ConversationMessageContent {...props} />));

    expect(container.querySelector(".bubble-collapsible-toggle")?.textContent).toBe("Show less");
  });

  it("expands a collapsed message when scrolling down past the bottom of the feed", () => {
    const content = Array.from({ length: 26 }, (_, index) => `Line ${index + 1}`).join("\n");
    container.style.overflowY = "auto";
    act(() => root.render(
      <ConversationMessageContent
        content={content}
        displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        enableLongMessageCollapse
      />
    ));
    const toggle = container.querySelector<HTMLButtonElement>(".bubble-collapsible-toggle");

    act(() => { container.dispatchEvent(new WheelEvent("wheel", { deltaY: -40 })); });
    expect(toggle?.textContent).toBe("Read more");

    act(() => { container.dispatchEvent(new WheelEvent("wheel", { deltaY: 40 })); });
    expect(toggle?.textContent).toBe("Show less");
  });

  it("intercepts artifact download links and calls triggerAuthenticatedBrowserDownload", async () => {
    localStorage.setItem("meowbert_token", "test-token-123");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/zip" }),
      blob: async () => new Blob(["data"])
    } as never);

    act(() => {
      root.render(
        <ConversationMessageContent
          content="Download [classroom_solution.zip](/api/projects/env-1/files/download?path=classroom_solution.zip)"
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link).toBeDefined();
    expect(link?.getAttribute("href")).toBe("/api/projects/env-1/files/download?path=classroom_solution.zip");

    await act(async () => {
      link?.click();
    });

    expect(fetchSpy).toHaveBeenCalledWith("http://localhost:4000/api/projects/env-1/files/download?path=classroom_solution.zip", {
      headers: { authorization: "Bearer test-token-123" }
    });
    fetchSpy.mockRestore();
  });

  it("downloads an existing reply's server filesystem link through the project API", async () => {
    localStorage.setItem("meowbert_token", "test-token-123");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "text/markdown" }),
      blob: async () => new Blob(["story"])
    } as never);
    const projectId = "594cd7a3-f81d-434e-9088-5987d58140d5";

    act(() => {
      root.render(
        <ConversationMessageContent
          content={`[five-original-sf-stories.md](/app/runtime/storage/onedrive-main/workspaces/8b158122-6a8b-4814-89d8-5c5a23d84056/environments/${projectId}/root/.meowbert/task-runs/run-1/five-original-sf-stories.md)`}
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("href"))
      .toBe(`http://localhost:4000/api/projects/${projectId}/files/download?path=.meowbert%2Ftask-runs%2Frun-1%2Ffive-original-sf-stories.md`);

    await act(async () => {
      link?.click();
    });

    expect(fetchSpy).toHaveBeenCalledWith(link?.href, {
      headers: { authorization: "Bearer test-token-123" }
    });
    fetchSpy.mockRestore();
  });

  it("downloads with the actual file name even when the link text is the link itself", async () => {
    localStorage.setItem("meowbert_token", "test-token-123");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/zip" }),
      blob: async () => new Blob(["data"])
    } as never);

    let downloadedFilename: string | null = null;
    const realCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const element = realCreateElement(tagName, options);
      if (tagName.toLowerCase() === "a") {
        const originalClick = element.click.bind(element);
        element.click = () => {
          if ((element as HTMLAnchorElement).download) {
            downloadedFilename = (element as HTMLAnchorElement).download;
          }
          originalClick();
        };
      }
      return element;
    });

    act(() => {
      root.render(
        <ConversationMessageContent
          content="Download [/api/projects/env-1/files/download?path=classroom_solution.zip](/api/projects/env-1/files/download?path=classroom_solution.zip)"
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    const link = container.querySelector<HTMLAnchorElement>("a");
    await act(async () => {
      link?.click();
    });

    expect(downloadedFilename).toBe("classroom_solution.zip");
    createElementSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("authenticates only exact configured API download routes", async () => {
    localStorage.setItem("meowbert_token", "test-token-123");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    act(() => {
      root.render(
        <ConversationMessageContent
          content="[bad](https://attacker.example/files/download?path=secret)"
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not put a token in the URL when a trusted download fails", async () => {
    localStorage.setItem("meowbert_token", "test-token-123");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network unavailable"));
    const openSpy = vi.spyOn(window, "open");

    act(() => {
      root.render(
        <ConversationMessageContent
          content="[download](/api/workspaces/workspace-1/files/download?path=report.pdf)"
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLAnchorElement>("a")?.click();
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(openSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    openSpy.mockRestore();
  });

  it("renders external links with target _blank and rel noopener noreferrer", () => {
    act(() => {
      root.render(
        <ConversationMessageContent
          content="Visit [Website](https://example.com)"
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders display math cleanly without lumping following markdown headings and paragraphs into errors", () => {
    const content = [
      "In Step 5 of your handout, you mix 10 mL of acid stock with 10 mL of base stock. Since you have made their concentrations equal, the intended calculation is:",
      "",
      "$$\\mathrm{pH}=\\mathrm{p}K_a+\\log\\left(\\frac{[\\mathrm{P^{2-}}]}{[\\mathrm{HP^-}]}\\right) =\\mathrm{p}K_a+\\log(1)",
      "=\\mathrm{p}K_a$$",
      "",
      "**So the procedure is deliberately designed to let you estimate the pKa by measuring that mixture’s pH.**",
      "",
      "### Will the meter show exactly 5.41?",
      "",
      "**Do not expect exactly 5.41.** Actual buffer pH depends on ionic interactions."
    ].join("\n");

    act(() => {
      root.render(
        <ConversationMessageContent
          content={content}
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector("h3")?.textContent).toBe("Will the meter show exactly 5.41?");
    const strongs = Array.from(container.querySelectorAll("strong")).map((el) => el.textContent);
    expect(strongs).toContain("So the procedure is deliberately designed to let you estimate the pKa by measuring that mixture’s pH.");
    expect(strongs).toContain("Do not expect exactly 5.41.");
  });

  it("renders inline math delimiters \\( ... \\) as KaTeX elements", () => {
    act(() => {
      root.render(
        <ConversationMessageContent
          content={"The concentration ratio is \\(\\frac{1}{2}\\)."}
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("renders square roots with KaTeX radical svg elements", () => {
    act(() => {
      root.render(
        <ConversationMessageContent
          content={"\\[ v \\propto \\frac{1}{\\sqrt{m}}, \\quad r \\propto \\sqrt{m}. \\]"}
          displayPreferences={buildDefaultTaskAssistantMessageDisplayPreferences()}
        />
      );
    });

    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
    const sqrts = container.querySelectorAll(".katex .sqrt");
    expect(sqrts.length).toBe(2);
    const svgs = container.querySelectorAll(".katex .sqrt svg");
    expect(svgs.length).toBe(2);
  });
});
