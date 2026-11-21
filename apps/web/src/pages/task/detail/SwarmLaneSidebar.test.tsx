// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSwarmLaneView, AgentSwarmNoteView } from "@meowbert/shared/agent-swarm-view";
import type { ApiClient } from "../../../lib/api";
import { SwarmLaneSidebar } from "./SwarmLaneSidebar";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock("./TaskDetailConversationPane", () => ({
  TaskDetailConversationPane: () => <div data-testid="lane-conversation-pane" />
}));

const LANE: AgentSwarmLaneView = {
  id: "lane-1",
  parentId: "swarm-1",
  groupId: "group-1",
  depth: 1,
  kind: "split",
  title: "TRAIN: v6.2 LoRA",
  direction: "Run step-24 gate and share milestones.",
  reviewEffort: null,
  status: "running",
  model: "claude-opus-5-5",
  steps: 42,
  spentTokens: 125_000,
  checkFindings: 0,
  summary: null,
  latestNote: "Step-24 gate passed.",
  resumable: false,
  createdAt: "2026-11-21T01:00:00.000Z",
  startedAt: "2026-11-21T01:01:00.000Z",
  endedAt: null
};

const NOTES: AgentSwarmNoteView[] = [
  {
    seq: "1",
    laneId: "lane-1",
    laneTitle: "TRAIN: v6.2 LoRA",
    kind: "shared",
    content: "Training launched on A100.",
    createdAt: "2026-11-21T01:05:00.000Z",
    notifySiblings: true,
    notifyParent: "inbox"
  },
  {
    seq: "2",
    laneId: "lane-2",
    laneTitle: "Eval harness",
    kind: "shared",
    content: "Holdout metrics script ready.",
    createdAt: "2026-11-21T01:10:00.000Z",
    notifySiblings: true,
    notifyParent: "none"
  },
  {
    seq: "3",
    laneId: "lane-1",
    laneTitle: "TRAIN: v6.2 LoRA",
    kind: "shared",
    content: "Step-24 gate PASS; requesting review.",
    createdAt: "2026-11-21T01:20:00.000Z",
    notifySiblings: false,
    notifyParent: "wake"
  }
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

function createMockApi(): ApiClient {
  return {
    get: vi.fn(async (url: string) => {
      if (url.includes("/swarm/notes")) return { notes: NOTES };
      return {
        task: {
          id: "lane-1",
          title: LANE.title,
          status: "running",
          created_at: LANE.createdAt,
          updated_at: "2026-11-21T01:22:00.000Z",
          source: "web"
        },
        messages: [],
        latest_context_usage: { usedTokens: 64_000, maxContextTokens: 200_000, cachedTokens: 48_000 },
        last_idle_compaction_at: null,
        workflow: null
      };
    })
  } as unknown as ApiClient;
}

describe("SwarmLaneSidebar", () => {
  it("shows context usage, chronological shared notes with scope/wake badges, and lane details", async () => {
    const api = createMockApi();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<SwarmLaneSidebar api={api} swarmTaskId="swarm-1" lane={LANE} onClose={() => {}} />);
    });

    expect(container.textContent).toContain("Context 32%");

    const notesTab = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']"))
      .find((button) => button.textContent?.includes("Shared notes"));
    expect(notesTab?.textContent).toContain("2");

    await act(async () => {
      notesTab?.click();
    });

    const laneItems = Array.from(container.querySelectorAll(".swarm-shared-note-body")).map((el) => el.textContent);
    expect(laneItems).toEqual(["Training launched on A100.", "Step-24 gate PASS; requesting review."]);
    expect(container.textContent).toContain("All");
    expect(container.textContent).toContain("Parent");
    expect(container.textContent).toContain("Woke parent");

    const allFilter = Array.from(container.querySelectorAll<HTMLButtonElement>(".swarm-shared-notes-filter-btn"))
      .find((button) => button.textContent?.includes("All swarm"));
    await act(async () => {
      allFilter?.click();
    });

    const allItems = Array.from(container.querySelectorAll(".swarm-shared-note-body")).map((el) => el.textContent);
    expect(allItems).toEqual([
      "Training launched on A100.",
      "Holdout metrics script ready.",
      "Step-24 gate PASS; requesting review."
    ]);
    expect(container.textContent).toContain("Eval harness");
    expect(container.textContent).toContain("Siblings");

    const detailsTab = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']"))
      .find((button) => button.textContent?.includes("Details"));
    await act(async () => {
      detailsTab?.click();
    });

    expect(container.textContent).toContain("claude-opus-5-5");
    expect(container.textContent).toContain("Run step-24 gate and share milestones.");
    expect(container.textContent).toContain("Context 32%");
  });
});
