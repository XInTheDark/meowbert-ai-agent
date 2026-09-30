/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultTaskParameters } from "../../task/taskParameters";
import { TaskParametersDropdown } from "./TaskParametersDropdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function click(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("TaskParametersDropdown", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows Deep Research and Experimental Quality control below Long Horizon", async () => {
    const onWorkflowChange = vi.fn();
    await act(async () => {
      root.render(
        <TaskParametersDropdown
          taskParameters={buildDefaultTaskParameters()}
          onChange={vi.fn()}
          mode="create"
          workflowConfig={{
            type: "standard",
            workerCount: 3,
            reviewRounds: 0,
            modelAllocations: [],
            tokenBudget: null
          }}
          onWorkflowChange={onWorkflowChange}
        />
      );
    });

    await act(async () => click(container.querySelector('[title="Task parameters"]')));

    const workflowItems = Array.from(container.querySelectorAll(".chat-tools-item"))
      .slice(0, 5)
      .map((element) => element.textContent?.replace(/\s+/g, " ").trim());

    expect(workflowItems).toEqual([
      "Standard task",
      "Long Horizon",
      "Deep Research",
      "Quality control Experimental",
      "Agent Swarm"
    ]);
    const swarmButton = Array.from(container.querySelectorAll(".chat-tools-item"))
      .find((element) => element.textContent?.includes("Agent Swarm"));
    await act(async () => click(swarmButton ?? null));
    const fields = Array.from(container.querySelectorAll(".task-parameters-field"));
    expect(fields.find((field) => field.textContent?.includes("Token budget"))?.querySelector("input")?.value).toBe("50000000");
    expect(fields.find((field) => field.textContent?.includes("Time budget"))?.querySelector("input")?.value).toBe("");
    await act(async () => click(container.querySelector(".task-parameters-actions .btn.primary")));
    expect(onWorkflowChange).toHaveBeenCalledWith(expect.objectContaining({
      type: "agent_swarm", tokenBudget: 50_000_000, timeBudgetMinutes: null
    }));
  });

  it("shows confirmation warning dialog when changing workflow type in edit mode", async () => {
    const onWorkflowChange = vi.fn();
    await act(async () => {
      root.render(
        <TaskParametersDropdown
          taskParameters={buildDefaultTaskParameters()}
          onChange={vi.fn()}
          mode="edit"
          taskType="standard"
          workflowConfig={{
            type: "standard",
            workerCount: 3,
            reviewRounds: 0,
            modelAllocations: [],
            tokenBudget: null
          }}
          onWorkflowChange={onWorkflowChange}
        />
      );
    });

    await act(async () => click(container.querySelector('[title="Task parameters"]')));

    const longHorizonButton = Array.from(container.querySelectorAll(".chat-tools-item"))
      .find((element) => element.textContent?.includes("Long Horizon"));
    expect(longHorizonButton).toBeDefined();

    await act(async () => click(longHorizonButton ?? null));

    // Confirm modal should now be in the DOM
    const modal = document.body.querySelector(".task-type-change-dialog");
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain("Changing the task type to Long Horizon may cause some workflow progress to be lost.");

    // Clicking confirm opens the longHorizon panel
    const confirmButton = document.body.querySelector(".task-type-change-dialog .btn.primary");
    await act(async () => click(confirmButton));

    // Modal should close
    expect(document.body.querySelector(".task-type-change-dialog")).toBeNull();
    // Long horizon form should be visible
    expect(container.textContent).toContain("Long Horizon");
    expect(container.textContent).toContain("Token budget");
    expect(container.textContent).toContain("Time budget");
    expect(container.textContent).toContain("Advanced options");
    expect(container.textContent).toContain("Clarify phase");
    expect(container.textContent).toContain("Review phase");
  });

  it("cancelling the confirmation dialog retains the current panel without changes", async () => {
    const onWorkflowChange = vi.fn();
    await act(async () => {
      root.render(
        <TaskParametersDropdown
          taskParameters={buildDefaultTaskParameters()}
          onChange={vi.fn()}
          mode="edit"
          taskType="standard"
          workflowConfig={{
            type: "standard",
            workerCount: 3,
            reviewRounds: 0,
            modelAllocations: [],
            tokenBudget: null
          }}
          onWorkflowChange={onWorkflowChange}
        />
      );
    });

    await act(async () => click(container.querySelector('[title="Task parameters"]')));

    const agentSwarmButton = Array.from(container.querySelectorAll(".chat-tools-item"))
      .find((element) => element.textContent?.includes("Agent Swarm"));

    await act(async () => click(agentSwarmButton ?? null));

    const modal = document.body.querySelector(".task-type-change-dialog");
    expect(modal).not.toBeNull();

    const cancelButton = document.body.querySelector(".task-type-change-dialog .btn.ghost");
    await act(async () => click(cancelButton));

    expect(document.body.querySelector(".task-type-change-dialog")).toBeNull();
    expect(onWorkflowChange).not.toHaveBeenCalled();
  });

  it("restores and saves Agent Swarm budget parameters from the selector", async () => {
    const onWorkflowChange = vi.fn();
    await act(async () => {
      root.render(
        <TaskParametersDropdown
          taskParameters={buildDefaultTaskParameters()}
          onChange={vi.fn()}
          mode="create"
          workflowConfig={{ type: "agent_swarm", workerCount: 0, reviewRounds: 0,
            leaderAgentId: "leader", modelAllocations: [], tokenBudget: 80_000, timeBudgetMinutes: 45 }}
          onWorkflowChange={onWorkflowChange}
        />
      );
    });

    await act(async () => click(container.querySelector('[title="Task parameters"]')));
    expect(container.textContent).toContain("80K tokens");
    const swarmButton = Array.from(container.querySelectorAll(".chat-tools-item"))
      .find((element) => element.textContent?.includes("Agent Swarm"));
    await act(async () => click(swarmButton ?? null));

    const fields = Array.from(container.querySelectorAll(".task-parameters-field"));
    const tokenInput = fields.find((field) => field.textContent?.includes("Token budget"))?.querySelector("input");
    const timeInput = fields.find((field) => field.textContent?.includes("Time budget"))?.querySelector("input");
    expect(tokenInput?.value).toBe("80000");
    expect(timeInput?.value).toBe("45");

    await act(async () => click(container.querySelector(".task-parameters-actions .btn.primary")));
    expect(onWorkflowChange).toHaveBeenCalledWith(expect.objectContaining({
      type: "agent_swarm", workerCount: 0, tokenBudget: 80_000, timeBudgetMinutes: 45
    }));
  });

  it("disables clearing the budget for an existing Agent Swarm", async () => {
    await act(async () => {
      root.render(
        <TaskParametersDropdown
          taskParameters={buildDefaultTaskParameters()}
          onChange={vi.fn()}
          mode="edit"
          workflowConfig={{ type: "agent_swarm", workerCount: 0, reviewRounds: 0,
            leaderAgentId: "leader", modelAllocations: [], tokenBudget: 80_000, timeBudgetMinutes: 45 }}
          onWorkflowChange={vi.fn()}
        />
      );
    });

    await act(async () => click(container.querySelector('[title="Task parameters"]')));
    const swarmButton = Array.from(container.querySelectorAll(".chat-tools-item"))
      .find((element) => element.textContent?.includes("Agent Swarm"));
    await act(async () => click(swarmButton ?? null));

    const checkbox = container.querySelector<HTMLInputElement>('.task-parameters-toggle input[type="checkbox"]');
    expect(checkbox?.disabled).toBe(true);
  });
});
