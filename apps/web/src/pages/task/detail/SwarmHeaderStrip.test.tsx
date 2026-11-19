/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSwarmLaneView } from "@meowbert/shared/agent-swarm-view";
import { SwarmHeaderStrip } from "./SwarmHeaderStrip";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function lane(overrides: Partial<AgentSwarmLaneView>): AgentSwarmLaneView {
  return {
    id: "lane", parentId: "root", groupId: "seed-1", depth: 1, kind: "split", title: "Lane", direction: null,
    status: "running", model: "gpt", steps: 3, spentTokens: 0, checkFindings: 0, summary: null, latestNote: null,
    resumable: false, createdAt: "2026-10-23T10:00:00Z", startedAt: null, endedAt: null,
    ...overrides
  };
}

describe("SwarmHeaderStrip", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it("lists the working lanes and opens the one picked", () => {
    const onOpenLane = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const view = {
      budgetsEnabled: false, tokenBudget: null, spentTokens: 0, deadlineAt: null, dormantLaneTurns: 2,
      lanes: [lane({ id: "eu", title: "EU" }), lane({ id: "pt", title: "PT2030", status: "done", resumable: true })]
    };
    act(() => root!.render(<SwarmHeaderStrip view={view} rootTaskId="root" onOpenLane={onOpenLane} />));

    const working = [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Working"))!;
    act(() => working.click());
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.querySelector("strong")?.textContent)).toEqual(["EU"]);
    act(() => (items[0] as HTMLButtonElement).click());
    expect(onOpenLane).toHaveBeenCalledWith("eu");
  });
});
