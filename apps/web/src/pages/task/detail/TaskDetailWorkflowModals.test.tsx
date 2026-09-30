/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { AgentSwarmWorkflowOverview, TaskDetail } from "../../../lib/types";
import { SwarmWorkerPovModal } from "./TaskDetailWorkflowModals";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createWorkerTaskDetail(): TaskDetail {
  return {
    task: {
      id: "worker-task-1",
      title: "Worker 1",
      status: "succeeded",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:01:00.000Z",
      source: "web"
    },
    messages: [{
      id: "tool-1",
      role: "tool",
      content_json: {
        tool: "run_shell",
        command: "pwd",
        stdout: "/workspace",
        durationMs: 10
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-08-28T00:00:30.000Z"
    }],
    runs: []
  };
}

describe("SwarmWorkerPovModal", () => {
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

  it("opens the tool-call inspector from a worker conversation", async () => {
    const api = {
      get: vi.fn().mockResolvedValue(createWorkerTaskDetail())
    } as unknown as ApiClient;
    const worker: AgentSwarmWorkflowOverview["agentSwarm"]["workers"][number] = {
      workflow_agent_id: "worker-agent-1",
      task_id: "worker-task-1",
      slot_index: 0,
      title: "Worker 1",
      status: "succeeded",
      paused: false,
      pause_reason: null,
      updated_at: "2026-08-28T00:01:00.000Z"
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<SwarmWorkerPovModal api={api} worker={worker} onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const toolActivity = document.body.querySelector<HTMLButtonElement>(".tool-activity-card");
    expect(toolActivity).not.toBeNull();

    await act(async () => toolActivity?.click());

    const inspector = document.body.querySelector(".tool-inspector-panel");
    expect(inspector?.textContent).toContain("run shell");

    await act(async () => inspector?.querySelector<HTMLButtonElement>(".tool-call-toggle")?.click());

    expect(inspector?.textContent).toContain("pwd");
  });
});
