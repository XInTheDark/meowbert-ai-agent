/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import { ScratchStorageSettings } from "./ScratchStorageSettings";
import { useScratchStorageSettings, type ScratchStorageOverview } from "./useScratchStorageSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

const overview: ScratchStorageOverview = {
  capacityBytes: 40 * 1024 * 1024, usedBytes: 10 * 1024 * 1024, availableBytes: 30 * 1024 * 1024,
  limitMb: 20, effectiveLimitBytes: 20 * 1024 * 1024, highWatermark: 0.85, targetWatermark: 0.7, minIdleMinutes: 60, maxIdleDays: 14
};

async function renderSettings(active = true) {
  const get = vi.fn(async () => overview);
  const patch = vi.fn(async (_path: string, body: { limitMb: number | null }) => ({ ...overview, ...body }));
  const api = { get, patch } as unknown as ApiClient;
  function Harness() { return <ScratchStorageSettings state={useScratchStorageSettings(api, active)} />; }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Harness />); });
  return { get, patch, container };
}

async function input(value: string) {
  const field = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function save() {
  await act(async () => { (Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Save")!).click(); });
}

describe("scratch budget control", () => {
  it("loads the saved budget, shows capacity and saves only an intentional scratch change", async () => {
    const view = await renderSettings();
    expect(view.get).toHaveBeenCalledWith("/api/admin/host-storage/scratch");
    expect(document.querySelector("input")!.value).toBe("20");
    expect(document.querySelector("input")!.max).toBe("40");
    expect(view.container.textContent).toContain("capacity");
    await input("15");
    await save();
    expect(view.patch).toHaveBeenCalledWith("/api/admin/host-storage/scratch", { limitMb: 15 });
  });

  it("rejects an over-capacity budget and lets blank reset to backing capacity", async () => {
    const view = await renderSettings();
    await input("41");
    await save();
    expect(view.patch).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("no larger than the backing capacity");
    await input("");
    await save();
    expect(view.patch).toHaveBeenCalledWith("/api/admin/host-storage/scratch", { limitMb: null });
  });

  it("does not fetch Admin data while the tab is inactive", async () => {
    const view = await renderSettings(false);
    expect(view.get).not.toHaveBeenCalled();
    expect(document.querySelector("input")!.disabled).toBe(true);
  });
});
