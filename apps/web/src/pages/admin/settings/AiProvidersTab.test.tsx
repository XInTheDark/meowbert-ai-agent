/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("../../../contexts/WorkspaceContext", () => ({ useWorkspaceApp: () => ({ api }) }));
import { AiProvidersTab } from "./AiProvidersTab";

const first = { id: "first", baseUrl: "https://one.test/v1", selected: true };
const second = { id: "second", baseUrl: "https://two.test/v1", selected: false };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderTab() {
  await act(async () => { root.render(<AiProvidersTab />); });
}

async function fillInput(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AI providers tab", () => {
  it("adds the first provider with only its URL and key and clears the secret draft", async () => {
    api.get.mockResolvedValue({ providers: [] });
    api.post.mockResolvedValue({ providers: [first] });
    await renderTab();
    expect(container.textContent).toContain("No providers yet");
    await fillInput('input[type="url"]', first.baseUrl);
    await fillInput('input[type="password"]', "secret-key");
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(api.post).toHaveBeenCalledWith("/api/admin/ai-providers", { baseUrl: first.baseUrl, apiKey: "secret-key" });
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
    expect(container.textContent).not.toContain("secret-key");
  });

  it("switches selection and removes the selected provider without choosing another implicitly", async () => {
    api.get.mockResolvedValue({ providers: [first, second] });
    api.post.mockResolvedValue({ providers: [{ ...first, selected: false }, { ...second, selected: true }] });
    api.delete.mockResolvedValue({ providers: [{ ...first, selected: false }] });
    await renderTab();
    await act(async () => { container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click(); });
    expect(api.post).toHaveBeenCalledWith("/api/admin/ai-providers/second/select");
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((input) => input.checked)).toEqual([false, true]);
    await act(async () => { container.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${second.baseUrl}"]`)!.click(); });
    expect(api.delete).toHaveBeenCalledWith("/api/admin/ai-providers/second");
    expect(container.textContent).toContain("Select a provider to enable platform AI runs");
    expect(container.textContent).not.toContain(second.baseUrl);
  });

  it("keeps the saved selection and displays the server error when switching fails", async () => {
    api.get.mockResolvedValue({ providers: [first, second] });
    api.post.mockRejectedValue(new Error("Could not save provider"));
    await renderTab();
    await act(async () => { container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click(); });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Could not save provider");
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
  });
});
