/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { LongHorizonWorkflowOverview, AgentSwarmWorkflowOverview } from "../../../lib/types";
import { TaskWorkflowSidebar } from "./TaskWorkflowSidebar";
import type { TaskDetailWorkflowSidebarController } from "./useTaskDetailWorkflowSidebar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TaskWorkflowSidebar", () => {
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

  const mockWorkflow: AgentSwarmWorkflowOverview = {
    type: "agent_swarm",
    phase: "running",
    config: {},
    agentSwarm: {
      workerCount: 2,
      channels: [
        { id: "chan-1", kind: "global", title: "General", member_task_ids: ["w1", "w2"], created_at: "2026-08-28T00:00:00Z", latest_message_no: 3 }
      ],
      workers: [
        { workflow_agent_id: "a1", task_id: "w1", slot_index: 0, title: "Worker 1", status: "running", updated_at: "2026-08-28T00:00:00Z" },
        { workflow_agent_id: "a2", task_id: "w2", slot_index: 1, title: "Worker 2", status: "succeeded", updated_at: "2026-08-28T00:00:00Z" }
      ]
    }
  };

  const mockApi = {
    get: vi.fn().mockResolvedValue({ items: [] })
  } as unknown as ApiClient;

  it("renders overview panel with workers and channels, and handles click to open worker", async () => {
    const sidebar: TaskDetailWorkflowSidebarController = {
      workflowSidebarStack: [{ kind: "overview" }],
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
      isWorkflowSidebarOpen: true,
      activePanel: { kind: "overview" }
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskWorkflowSidebar
          api={mockApi}
          taskId="task-1"
          workflow={mockWorkflow}
          sidebar={sidebar}
        />
      );
    });

    expect(container.textContent).toContain("Agent Swarm");
    expect(container.textContent).toContain("Workflow Overview");
    expect(container.textContent).toContain("Workers (2)");
    expect(container.textContent).toContain("Worker 1");
    expect(container.textContent).toContain("Worker 2");
    expect(container.textContent).toContain("General");

    const workerBtn = container.querySelector<HTMLButtonElement>(".workflow-worker-item");
    await act(async () => workerBtn?.click());
    expect(sidebar.openWorker).toHaveBeenCalledWith(mockWorkflow.agentSwarm.workers[0]);

    const closeBtn = container.querySelector<HTMLButtonElement>(".thread-sidebar-header-actions button");
    await act(async () => closeBtn?.click());
    expect(sidebar.closeSidebar).toHaveBeenCalledTimes(1);
  });

  it("renders plan panel and back button when stack has depth > 1", async () => {
    const longHorizonWorkflow: LongHorizonWorkflowOverview = {
      type: "long_horizon",
      phase: "running",
      config: {},
      longHorizon: {
        plan: { content: "# Implementation Steps\n1. First step", createdAt: "2026-08-28T00:00:00Z" },
        latestRound: 1,
        latestSubmissionMessage: "Current submission",
        reviews: [],
        reviewers: [
          {
            workflow_agent_id: "reviewer-agent-1",
            task_id: "reviewer-task-1",
            slot_index: 0,
            title: "Long Horizon Task · Reviewer 1",
            status: "running",
            updated_at: "2026-08-28T00:01:00Z"
          }
        ]
      }
    };
    const sidebar: TaskDetailWorkflowSidebarController = {
      workflowSidebarStack: [
        { kind: "overview" },
        { kind: "plan" }
      ],
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
      isWorkflowSidebarOpen: true,
      activePanel: { kind: "plan" }
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskWorkflowSidebar
          api={mockApi}
          taskId="task-1"
          workflow={longHorizonWorkflow}
          sidebar={sidebar}
        />
      );
    });

    expect(container.textContent).toContain("Plan");
    expect(container.textContent).toContain("Implementation Steps");

    await act(async () => {
      root?.render(
        <TaskWorkflowSidebar
          api={mockApi}
          taskId="task-1"
          workflow={{
            ...longHorizonWorkflow,
            longHorizon: {
              ...longHorizonWorkflow.longHorizon,
              plan: { content: "# Updated Steps", createdAt: "2026-08-28T00:02:00Z" }
            }
          }}
          sidebar={sidebar}
        />
      );
    });

    expect(container.textContent).toContain("Updated Steps");
    expect(container.textContent).not.toContain("Implementation Steps");

    const backBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Back to overview"]');
    expect(backBtn).not.toBeNull();
    await act(async () => backBtn?.click());
    expect(sidebar.popPanel).toHaveBeenCalledTimes(1);
  });

  it("shows an in-progress reviewer and opens its point of view", async () => {
    const longHorizonWorkflow: LongHorizonWorkflowOverview = {
      type: "long_horizon",
      phase: "reviewing",
      config: {},
      longHorizon: {
        plan: { content: "# Plan", createdAt: "2026-08-28T00:00:00Z" },
        latestRound: 1,
        latestSubmissionMessage: "Current submission",
        reviews: [],
        reviewers: [
          {
            workflow_agent_id: "reviewer-agent-1",
            task_id: "reviewer-task-1",
            slot_index: 0,
            title: "Reviewer 1",
            status: "running",
            updated_at: "2026-08-28T00:01:00Z"
          }
        ]
      }
    };
    const sidebar: TaskDetailWorkflowSidebarController = {
      workflowSidebarStack: [{ kind: "overview" }],
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
      isWorkflowSidebarOpen: true,
      activePanel: { kind: "overview" }
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskWorkflowSidebar
          api={mockApi}
          taskId="task-1"
          workflow={longHorizonWorkflow}
          sidebar={sidebar}
        />
      );
    });

    expect(container.textContent).toContain("Reviewer Verdicts (0)");
    expect(container.textContent).toContain("in progress");
    expect(container.textContent).toContain("Reviewing round 1");

    const reviewerButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".workflow-sidebar-card"))
      .find((button) => button.textContent?.includes("Reviewer 1") && button.textContent?.includes("in progress"));
    await act(async () => reviewerButton?.click());
    expect(sidebar.openReviewer).toHaveBeenCalledWith(longHorizonWorkflow.longHorizon.reviewers[0]);
  });
});
