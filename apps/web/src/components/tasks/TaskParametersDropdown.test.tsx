/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS } from "@meowbert/shared/agent-swarm-config";
import { normalizeAgentSwarmSettings } from "@meowbert/shared/agent-swarm-config";
import type { ApiClient } from "../../lib/api";
import type { TaskDetail, TaskWorkflowComposerConfig } from "../../lib/types";
import { buildWorkflowComposerConfigFromTaskDetail } from "../../pages/task/detail/useTaskDetailComposer";
import { updateTaskParameters } from "../../pages/task/detail/taskDetailMutations";
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
    expect(container.textContent).not.toContain("Token budget");
    expect(onWorkflowChange).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_swarm" }));
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
          workflowConfig={{ type: "agent_swarm", routerId: null, budgetsEnabled: true,
            tokenBudget: 80_000, timeBudgetMinutes: 45 }}
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
  });

  it("switches Agent Swarm budgets off and hides the budget fields", async () => {
    const onWorkflowChange = vi.fn();
    await act(async () => {
      root.render(
        <TaskParametersDropdown
          taskParameters={buildDefaultTaskParameters()}
          onChange={vi.fn()}
          mode="create"
          workflowConfig={{ type: "agent_swarm", routerId: null, budgetsEnabled: true,
            tokenBudget: 80_000, timeBudgetMinutes: 45 }}
          onWorkflowChange={onWorkflowChange}
        />
      );
    });

    await act(async () => click(container.querySelector('[title="Task parameters"]')));
    const swarmButton = Array.from(container.querySelectorAll(".chat-tools-item"))
      .find((element) => element.textContent?.includes("Agent Swarm"));
    await act(async () => click(swarmButton ?? null));
    await act(async () => click(container.querySelector('.task-parameters-toggle input[type="checkbox"]')));

    expect(onWorkflowChange).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_swarm", budgetsEnabled: false }));
    expect(container.textContent).not.toContain("Token budget");
  });

  it("edits a saved swarm lane limit without changing its budgets or other settings", async () => {
    const settings = normalizeAgentSwarmSettings({ budgetsEnabled: true, tokenBudget: 1_000_000,
      timeBudgetMinutes: 45, routerId: "router-v1", advanced: { maxDepth: 3, autoCheck: false, maxRunningLanes: 4 } });
    const taskDetail = { task: { task_type: "agent_swarm" },
      workflow: { type: "agent_swarm", phase: "working", config: settings } } as unknown as TaskDetail;
    const patch = vi.fn().mockResolvedValue({});
    const api = { patch } as unknown as ApiClient;
    const onWorkflowChange = vi.fn(async (workflow: TaskWorkflowComposerConfig) => {
      await updateTaskParameters(api, "swarm-1", { workflow, previousWorkflow: taskDetail.workflow });
    });
    await act(async () => root.render(<TaskParametersDropdown
      taskParameters={buildDefaultTaskParameters()} onChange={vi.fn()} mode="edit" taskType="agent_swarm"
      workflowConfig={buildWorkflowComposerConfigFromTaskDetail(taskDetail)} onWorkflowChange={onWorkflowChange}
    />));
    await act(async () => click(container.querySelector('[title="Task parameters"]')));
    const swarmButton = Array.from(container.querySelectorAll(".chat-tools-item"))
      .find((element) => element.textContent?.includes("Agent Swarm"));
    await act(async () => click(swarmButton ?? null));
    const fields = Array.from(container.querySelectorAll(".task-parameters-field"));
    expect(fields.find((field) => field.textContent?.includes("Token budget"))?.querySelector("input")?.value).toBe("1000000");
    expect(fields.find((field) => field.textContent?.includes("Lane depth"))?.querySelector("input")?.value).toBe("3");
    const running = fields.find((field) => field.textContent?.includes("Lanes running at once"))?.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(running, "5");
      running.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => running.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(onWorkflowChange).toHaveBeenCalledWith(expect.objectContaining({ budgetsEnabled: true, tokenBudget: 1_000_000,
      timeBudgetMinutes: 45, routerId: "router-v1", advanced: expect.objectContaining({ maxDepth: 3, autoCheck: false, maxRunningLanes: 5 }) }));
    expect(patch).toHaveBeenCalledWith("/api/tasks/swarm-1/parameters", {
      workflow: { type: "agent_swarm", advanced: { maxRunningLanes: 5 } }
    });
  });

  it("offers the platform's routers and applies an advanced lane limit for an Agent Swarm", async () => {
    const onWorkflowChange = vi.fn();
    const swarm = {
      leaderAgentId: "luna", routerId: null, routerOptions: ["router-v1"], budgetsEnabled: false,
      tokenBudget: null, timeBudgetMinutes: null, advanced: DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS
    };
    await act(async () => {
      root.render(
        <TaskParametersDropdown
          taskParameters={buildDefaultTaskParameters()}
          onChange={vi.fn()}
          mode="create"
          workflowConfig={{ type: "agent_swarm", routerId: null, budgetsEnabled: false, tokenBudget: null,
            advanced: DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS }}
          onWorkflowChange={onWorkflowChange}
          availableAgents={[{ id: "research", name: "Research", description: "", mode: "agent_swarm", swarm }]}
          selectedAgentId="research"
        />
      );
    });
    await act(async () => click(container.querySelector('[title="Task parameters"]')));
    const swarmButton = Array.from(container.querySelectorAll(".chat-tools-item"))
      .find((element) => element.textContent?.includes("Agent Swarm"));
    await act(async () => click(swarmButton ?? null));

    const routerSelect = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      routerSelect.value = "router-v1";
      routerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onWorkflowChange).toHaveBeenLastCalledWith(expect.objectContaining({ routerId: "router-v1" }));

    const fields = Array.from(container.querySelectorAll(".task-parameters-field"));
    const depthInput = fields.find((field) => field.textContent?.includes("Lane depth"))?.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(depthInput, "1");
      depthInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => depthInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(onWorkflowChange).toHaveBeenLastCalledWith(expect.objectContaining({
      advanced: expect.objectContaining({ maxDepth: 1 })
    }));
  });
});
