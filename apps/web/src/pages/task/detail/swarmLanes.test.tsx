/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSwarmLaneView } from "@meowbert/shared/agent-swarm-view";
import type { TaskMessage } from "../../../lib/types";
import { buildSwarmLaneGroups, listDormantSwarmLanes } from "./swarmLaneGroups";
import { SwarmLaneTracks } from "./SwarmLaneTracks";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function lane(overrides: Partial<AgentSwarmLaneView>): AgentSwarmLaneView {
  return {
    id: "lane", parentId: "root", groupId: "seed-1", depth: 1, kind: "split", title: "Lane", direction: null,
    status: "running", model: "gpt", steps: 3, spentTokens: 0, checkFindings: 0, summary: null, latestNote: null,
    resumable: false, createdAt: "2026-10-23T10:00:00Z", startedAt: null, endedAt: null,
    ...overrides
  };
}

function message(id: string, createdAt: string): TaskMessage {
  return { id, role: "assistant", content_json: {}, created_at: createdAt } as TaskMessage;
}

describe("swarm lane groups", () => {
  const lanes = [
    lane({ id: "eu", title: "EU" }),
    lane({ id: "pt", title: "PT2030" }),
    lane({ id: "eic", title: "EIC", parentId: "eu", depth: 2, groupId: "seed-2", createdAt: "2026-10-23T10:05:00Z" }),
    lane({ id: "check", title: "Check", kind: "check", groupId: "seed-3", status: "done", createdAt: "2026-10-23T10:20:00Z" })
  ];

  it("groups the leader's lanes by the call that started them, with sub-lanes nested under their lane", () => {
    const groups = buildSwarmLaneGroups(lanes, "root", []);
    expect(groups.map((group) => group.nodes.map((node) => node.lane.id))).toEqual([["eu", "pt"], ["check"]]);
    expect(groups[0].nodes[0].children.map((child) => child.lane.id)).toEqual(["eic"]);
  });

  it("anchors each group under the first message written after its lanes", () => {
    const messages = [message("ask", "2026-10-23T09:59:00Z"), message("split-call", "2026-10-23T10:00:01Z"), message("reply", "2026-10-23T10:21:00Z")];
    expect(buildSwarmLaneGroups(lanes, "root", messages).map((group) => group.anchorMessageId)).toEqual(["split-call", "reply"]);
  });

  it("lists only the leader's resumable lanes as dormant", () => {
    expect(listDormantSwarmLanes([lane({ id: "a", resumable: true }), lane({ id: "b", parentId: "a", resumable: true }), lane({ id: "c" })], "root")
      .map((item) => item.id)).toEqual(["a"]);
  });
});

describe("swarm lane tracks", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it("offers stop only for working lanes and opens a lane on request", () => {
    const onOpenLane = vi.fn();
    const onStopLane = vi.fn();
    const [group] = buildSwarmLaneGroups([
      lane({ id: "eu", title: "EU", latestNote: "SME status fails above 25%." }),
      lane({ id: "pt", title: "PT2030", status: "done", summary: "Four programs." })
    ], "root", []);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<SwarmLaneTracks group={group} budgetsEnabled={false} onOpenLane={onOpenLane} onStopLane={onStopLane} />));

    expect(container.textContent).toContain("SME status fails above 25%.");
    expect(container.textContent).toContain("Four programs.");
    expect(container.querySelectorAll('[aria-label^="Stop lane"]')).toHaveLength(1);
    act(() => (container!.querySelector('[aria-label="Stop lane EU"]') as HTMLButtonElement).click());
    act(() => (container!.querySelector('[aria-label="Open lane PT2030"]') as HTMLButtonElement).click());
    expect(onStopLane).toHaveBeenCalledWith("eu");
    expect(onOpenLane).toHaveBeenCalledWith("pt");
  });
});
