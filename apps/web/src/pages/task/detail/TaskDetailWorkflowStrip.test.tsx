/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSwarmWorkflowOverview, LongHorizonWorkflowOverview } from "../../../lib/types";
import { TaskDetailWorkflowStrip } from "./TaskDetailWorkflowStrip";
import type { TaskDetailWorkflowSidebarController } from "./useTaskDetailWorkflowSidebar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createMockSidebarController(overrides?: Partial<TaskDetailWorkflowSidebarController>): TaskDetailWorkflowSidebarController {
  return {
    workflowSidebarStack: [],
    setWorkflowSidebarStack: vi.fn(),
    openOverview: vi.fn(),
    openWorker: vi.fn(),
    openChannel: vi.fn(),
    openPlan: vi.fn(),
    openSubmission: vi.fn(),
    openReview: vi.fn(),
    openReviewer: vi.fn(),
    popPanel: vi.fn(),
    closeSidebar: vi.fn(),
    isWorkflowSidebarOpen: false,
    activePanel: null,
    ...overrides
  };
}

describe("TaskDetailWorkflowStrip", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("renders Agent Swarm strip with worker and channel metrics", async () => {
    const workflow: AgentSwarmWorkflowOverview = {
      type: "agent_swarm",
      phase: "running",
      config: {},
      agentSwarm: {
        workerCount: 3,
        channels: [
          { id: "c1", kind: "global", title: "Global", member_task_ids: ["w1", "w2"], created_at: "2026-08-28T00:00:00Z", latest_message_no: 5 }
        ],
        workers: [
          { workflow_agent_id: "a1", task_id: "w1", slot_index: 0, title: "Worker 1", status: "running", updated_at: "2026-08-28T00:00:00Z" },
          { workflow_agent_id: "a2", task_id: "w2", slot_index: 1, title: "Worker 2", status: "succeeded", updated_at: "2026-08-28T00:00:00Z" },
          { workflow_agent_id: "a3", task_id: "w3", slot_index: 2, title: "Worker 3", status: "queued", updated_at: "2026-08-28T00:00:00Z" }
        ]
      }
    };

    const sidebar = createMockSidebarController();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<TaskDetailWorkflowStrip workflow={workflow} sidebar={sidebar} />);
    });

    expect(container.textContent).toContain("Agent Swarm");
    expect(container.textContent).toContain("running");
    expect(container.textContent).toContain("2/3 active");
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("Details");

    const mainBtn = container.querySelector<HTMLButtonElement>(".task-workflow-strip-main");
    await act(async () => mainBtn?.click());
    expect(sidebar.openOverview).toHaveBeenCalledTimes(1);
  });

  it("renders Long Horizon strip with round and review verdicts", async () => {
    const workflow: LongHorizonWorkflowOverview = {
      type: "long_horizon",
      phase: "completed",
      config: { reviewMode: "quality_control" },
      longHorizon: {
        latestRound: 2,
        plan: { content: "# Plan", createdAt: "2026-08-28T00:00:00Z" },
        latestSubmissionMessage: "Done",
        reviews: [
          { id: "r1", round_no: 2, reviewer_task_id: "rt1", reviewer_slot_index: 0, approved: true, review: "Great", created_at: "2026-08-28T00:00:00Z" },
          { id: "r2", round_no: 2, reviewer_task_id: "rt2", reviewer_slot_index: 1, approved: false, review: "Needs work", created_at: "2026-08-28T00:00:00Z" }
        ],
        reviewers: [
          { workflow_agent_id: "a1", task_id: "rt1", slot_index: 0, title: "Reviewer 1", status: "succeeded", updated_at: "2026-08-28T00:00:00Z" },
          { workflow_agent_id: "a2", task_id: "rt2", slot_index: 1, title: "Reviewer 2", status: "succeeded", updated_at: "2026-08-28T00:00:00Z" }
        ]
      }
    };

    const sidebar = createMockSidebarController({ isWorkflowSidebarOpen: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<TaskDetailWorkflowStrip workflow={workflow} sidebar={sidebar} />);
    });

    expect(container.textContent).toContain("Quality Control");
    expect(container.textContent).toContain("Round");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("1/2 approved");
    expect(container.textContent).toContain("Hide");

    const actionBtn = container.querySelector<HTMLButtonElement>(".task-workflow-strip-action");
    await act(async () => actionBtn?.click());
    expect(sidebar.closeSidebar).toHaveBeenCalledTimes(1);
  });
});
