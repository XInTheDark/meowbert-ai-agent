/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSettingsTab } from "./ModelSettingsTab";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("model settings swarm generator", () => {
  it("opens a tree editor that shows model presets and can add a nested swarm", async () => {
    await act(async () => root.render(<ModelSettingsTab
      usageRateMultiplier={1} modelMetadataDraft="{}" modelRoutersDraft="[]"
      modelSliderAgentIdsDraft="[]" specializedModelsDraft="{}"
      agentPresetsDraft={JSON.stringify([{ id: "fast", name: "Fast", payload: {}, description: "Fast" }])}
      isSaving={false} hasSettings error={null}
      onUsageRateMultiplierChange={vi.fn()} onModelMetadataDraftChange={vi.fn()}
      onModelRoutersDraftChange={vi.fn()} onModelSliderAgentIdsDraftChange={vi.fn()}
      onAgentPresetsDraftChange={vi.fn()} onSpecializedModelsDraftChange={vi.fn()}
      onSubmit={vi.fn()}
    />));
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Agent swarm generator"))!.click();
    });
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="swarm-generator-title"]')!;
    expect(dialog.textContent).toContain("Root swarm");
    expect(dialog.querySelector<HTMLInputElement>('.swarm-generator-spawnable input')?.checked).toBe(false);
    await act(async () => {
      Array.from(dialog.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Model"))!.click();
    });
    expect(dialog.querySelector('select[aria-label="Leader model"]')?.textContent).toContain("Fast (fast)");
    await act(async () => {
      Array.from(dialog.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Swarm"))!.click();
    });
    expect(dialog.textContent).toContain("Nested swarm");
  });

  it("adds valid generated presets to the existing draft without saving settings", async () => {
    const onDraftChange = vi.fn();
    const onSubmit = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(async () => root.render(<ModelSettingsTab
      usageRateMultiplier={1} modelMetadataDraft="{}" modelRoutersDraft="[]"
      modelSliderAgentIdsDraft="[]" specializedModelsDraft="{}"
      agentPresetsDraft={JSON.stringify([{ id: "fast", name: "Fast", payload: {}, description: "Fast" }])}
      isSaving={false} hasSettings error={null}
      onUsageRateMultiplierChange={vi.fn()} onModelMetadataDraftChange={vi.fn()}
      onModelRoutersDraftChange={vi.fn()} onModelSliderAgentIdsDraftChange={vi.fn()}
      onAgentPresetsDraftChange={onDraftChange} onSpecializedModelsDraftChange={vi.fn()}
      onSubmit={onSubmit}
    />));
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Agent swarm generator"))!.click();
    });
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="swarm-generator-title"]')!;
    const clickModel = async (first = false) => act(async () => {
      Array.from(dialog.querySelectorAll("button"))
        .filter((button) => button.textContent?.trim() === "Model").at(first ? 0 : -1)!.click();
    });
    await clickModel(true);
    await clickModel();
    await clickModel();
    for (const select of dialog.querySelectorAll<HTMLSelectElement>("select")) {
      await act(async () => {
        select.value = "fast";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    const addButton = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Add to agent presets"))!;
    expect(addButton.disabled, dialog.querySelector("[role='status']")?.textContent ?? "").toBe(false);
    await act(async () => {
      Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Copy")!.click();
    });
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject([{ id: "agent-swarm-1" }]);
    await act(async () => addButton.click());
    expect(onSubmit).not.toHaveBeenCalled();
    const draft = JSON.parse(onDraftChange.mock.calls[0][0]) as Array<{ id: string; mode?: string; spawnableAsNode?: boolean }>;
    expect(draft.map((entry) => entry.id)).toEqual(["fast", "agent-swarm-1"]);
    expect(draft[1].mode).toBe("agent_swarm");
    expect(draft[1].spawnableAsNode).toBe(false);
  });
});
