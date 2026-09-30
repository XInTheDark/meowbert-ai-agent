/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { SwarmChannelMessage } from "../../../lib/types";
import { TaskWorkflowChannelPanel } from "./TaskWorkflowChannelPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TaskWorkflowChannelPanel", () => {
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

  it("loads and displays swarm channel messages with sender role labels", async () => {
    const mockMessages: SwarmChannelMessage[] = [
      {
        id: "m1",
        channel_id: "chan-1",
        sender_task_id: "leader-task",
        sender_role: "leader",
        message_no: 1,
        content_markdown: "Welcome to the Agent Swarm session.",
        created_at: "2026-08-28T00:00:00.000Z"
      },
      {
        id: "m2",
        channel_id: "chan-1",
        sender_task_id: "worker-task-1",
        sender_role: "worker",
        sender_slot_index: 0,
        message_no: 2,
        content_markdown: "Worker 1 ready and exploring files.",
        created_at: "2026-08-28T00:01:00.000Z"
      }
    ];

    const api = {
      get: vi.fn().mockResolvedValue({ items: mockMessages })
    } as unknown as ApiClient;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskWorkflowChannelPanel
          api={api}
          taskId="task-1"
          channelId="chan-1"
          channelTitle="Global"
          channelKind="global"
          memberCount={3}
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Leader");
    expect(container.textContent).toContain("Welcome to the Agent Swarm session.");
    expect(container.textContent).toContain("Worker 1");
    expect(container.textContent).toContain("Worker 1 ready and exploring files.");
    expect(container.textContent).toContain("#1");
    expect(container.textContent).toContain("#2");
  });
});
