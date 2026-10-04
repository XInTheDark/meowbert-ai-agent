/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { TaskDetail } from "../../../lib/types";
import { TaskWorkflowWorkerPanel } from "./TaskWorkflowWorkerPanel";

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
        command: "ls -la",
        stdout: "file1.txt\nfile2.txt",
        durationMs: 15
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-08-28T00:00:30.000Z"
    }],
    runs: []
  };
}

describe("TaskWorkflowWorkerPanel", () => {
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

  it("loads and displays worker task details and tool inspector", async () => {
    const api = {
      get: vi.fn().mockResolvedValue(createWorkerTaskDetail())
    } as unknown as ApiClient;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskWorkflowWorkerPanel
          api={api}
          workerTaskId="worker-task-1"
          slotIndex={0}
          workerTitle="Worker 1"
          status="succeeded"
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("succeeded");
    await act(async () => container?.querySelector<HTMLButtonElement>(".activity-disclosure-toggle")?.click());
    const toolActivity = container.querySelector<HTMLButtonElement>(".tool-activity-card");
    expect(toolActivity).not.toBeNull();

    await act(async () => toolActivity?.click());

    const inspector = document.body.querySelector(".tool-inspector-panel");
    expect(inspector?.textContent).toContain("run shell");

    await act(async () => inspector?.querySelector<HTMLButtonElement>(".tool-call-toggle")?.click());
    expect(inspector?.textContent).toContain("ls -la");
  });
});
