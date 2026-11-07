/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectMap } from "@meowbert/shared/project-map";
import { ProjectMapView } from "./ProjectMapView";

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock("../../../contexts/WorkspaceContext", () => ({ useWorkspaceApp: () => ({ api }) }));
vi.mock("../../../components/taskConversation/ConversationMessageContent", () => ({
  ConversationMessageContent: ({ content }: { content: string }) => <p>{content}</p>
}));

function mapFor(brief: string): ProjectMap {
  return {
    brief, folders: [], tasks: [], tasksTruncated: false,
    cards: [{ id: "card", folderId: null, title: "Plan", body: "Details", state: "idea", sortOrder: 0 }]
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Project map editing", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, "localStorage", {
      configurable: true, value: { getItem: () => null, setItem: vi.fn() }
    });
    api.get.mockResolvedValue(mapFor("Project A brief"));
    api.put.mockResolvedValue({ ok: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(projectId: string) {
    await act(async () => root.render(
      <MemoryRouter><ProjectMapView workspaceId="workspace" projectId={projectId} masterTaskId="master" variant="pane" /></MemoryRouter>
    ));
  }

  async function click(selector: string) {
    const element = container.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    await act(async () => element!.click());
  }

  async function submit() {
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  }

  it("discards the previous brief editor and selection while the new project loads or fails", async () => {
    await render("A");
    await click('[aria-label="Select Plan"]');
    await click('[aria-label="Edit brief"]');
    expect(container.querySelector("textarea")?.value).toBe("Project A brief");
    const next = deferred<ProjectMap>();
    api.get.mockReturnValue(next.promise);
    await render("B");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toContain("Project A brief");
    expect(container.querySelector('[aria-label="Edit brief"]')).toBeNull();
    await act(async () => next.reject(new Error("Project B unavailable")));
    expect(container.textContent).toContain("Project B unavailable");
    expect(container.querySelector("form")).toBeNull();
    expect(api.put).not.toHaveBeenCalled();
    api.get.mockResolvedValue(mapFor("Project A brief"));
    await render("A");
    expect(container.querySelector('[aria-label="Clear selection"]')).toBeNull();
  });

  it("starts the new project with its own brief and no selected items", async () => {
    await render("A");
    await click('[aria-label="Select Plan"]');
    await click('[aria-label="Edit brief"]');
    api.get.mockResolvedValue(mapFor("Project B brief"));
    await render("B");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Select Plan"]')?.checked).toBe(false);
    expect(container.querySelector('[aria-label="Clear selection"]')).toBeNull();
    await click('[aria-label="Edit brief"]');
    await submit();
    expect(api.put).toHaveBeenCalledWith("/api/projects/B/map/brief", { markdown: "Project B brief" });
  });

  it("ignores a late load from the previous project", async () => {
    const previous = deferred<ProjectMap>();
    api.get.mockReturnValueOnce(previous.promise).mockResolvedValue(mapFor("Project B brief"));
    await render("A");
    await render("B");
    await act(async () => previous.resolve(mapFor("Project A late brief")));
    expect(container.textContent).toContain("Project B brief");
    expect(container.textContent).not.toContain("Project A late brief");
    await click('[aria-label="Edit brief"]');
    await submit();
    expect(api.put).toHaveBeenCalledWith("/api/projects/B/map/brief", { markdown: "Project B brief" });
  });

  it("keeps a rejected save visible inside the editor across successful refreshes, then allows correction", async () => {
    vi.useFakeTimers();
    await render("A");
    await click('[aria-label="Edit brief"]');
    api.put.mockRejectedValueOnce(new Error("Project brief is longer than 40000 characters."));
    await submit();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(container.querySelector("form [role=alert]")?.textContent).toContain("longer than 40000");
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(container.querySelector("form [role=alert]")?.textContent).toContain("longer than 40000");
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Corrected brief");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(api.put).toHaveBeenLastCalledWith("/api/projects/A/map/brief", { markdown: "Corrected brief" });
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("longer than 40000");
  });

  it("dismisses an editor error when the editor is closed", async () => {
    await render("A");
    await click('[aria-label="Edit brief"]');
    api.put.mockRejectedValueOnce(new Error("Rejected change"));
    await submit();
    await click('[aria-label="Close"]');
    await click('[aria-label="Edit brief"]');
    expect(container.querySelector("form [role=alert]")).toBeNull();
  });
});
