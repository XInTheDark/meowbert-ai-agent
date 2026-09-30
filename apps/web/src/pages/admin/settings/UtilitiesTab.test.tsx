/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock("../../../contexts/WorkspaceContext", () => ({ useWorkspaceApp: () => ({ api }) }));
import { UtilitiesTab } from "./UtilitiesTab";

const provider = { id: "11111111-1111-4111-8111-111111111111", baseUrl: "https://provider.test/v1", selected: true };
const schedule = {
  id: "22222222-2222-4222-8222-222222222222", name: "Morning window", providerId: provider.id, model: "model-a", enabled: true,
  rules: [{ kind: "interval" as const, days: [1, 2, 3, 4, 5], everyMinutes: 30, windows: [{ start: "03:00", end: "05:00" }] }],
  nextRunAt: "2026-09-29T03:30:00.000Z", lastRunAt: "2026-09-29T03:00:00.000Z", lastFinishedAt: "2026-09-29T03:00:02.000Z",
  lastStatus: "succeeded" as const, lastError: null
};
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockImplementation((path: string) => path.includes("ai-providers") ? Promise.resolve({ providers: [provider] }) : Promise.resolve({ schedules: [schedule] }));
  api.patch.mockResolvedValue({ schedule: { ...schedule, enabled: false, nextRunAt: null } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("Utilities scheduled usage activation", () => {
  it("shows UTC schedule details and toggles the saved schedule without sending a request", async () => {
    await act(async () => root.render(<UtilitiesTab models={["model-a"]} />));
    expect(container.textContent).toContain("Morning window");
    expect(container.textContent).toContain("every 30 min");
    expect(container.textContent).toContain("2026-09-29 03:30 UTC");
    expect(container.textContent).toContain("Last: succeeded");
    await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="Enable Morning window"]')!.click());
    expect(api.patch).toHaveBeenCalledWith(`/api/admin/utilities/usage-activation/${schedule.id}`, {
      name: schedule.name, model: schedule.model, providerId: provider.id, enabled: false, rules: schedule.rules
    });
    expect(api.patch.mock.calls[0][1]).not.toHaveProperty("id");
  });
  it("opens a new editor with UTC rules and supports a separate interval window", async () => {
    await act(async () => root.render(<UtilitiesTab models={["model-a"]} />));
    await act(async () => (container.querySelector<HTMLButtonElement>('button[aria-label="Refresh schedules"]')!.parentElement!.querySelector("button.btn.primary") as HTMLButtonElement).click());
    expect(container.textContent).toContain("New schedule");
    expect(container.textContent).toContain("Rule 1 · UTC");
    expect(container.querySelector(".activation-rule select")?.textContent).toContain("Every interval");
  });
});
