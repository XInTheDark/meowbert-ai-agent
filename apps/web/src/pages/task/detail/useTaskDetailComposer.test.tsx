/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { TaskDetail } from "../../../lib/types";
import { findCacheBreakingChanges } from "../../../task/cacheBreakingChanges";
import { updateTaskInputDraftForProject, writeTaskInputDrafts } from "../../../task/taskInputDrafts";
import { useTaskDetailComposer, type TaskDetailComposer } from "./useTaskDetailComposer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const api = {} as ApiClient;
const agents = [{ id: "opus" }, { id: "gpt" }];

function detail(messageId: string, webSearch = true, agentId = "opus"): TaskDetail {
  return {
    task: { id: "task", title: null, status: "succeeded", source: "web", created_at: "", updated_at: "" },
    messages: [],
    latest_user_message: { id: messageId, content_json: { tools: { webSearch }, agent: { id: agentId } } }
  };
}

function renderComposer(initialDetail: TaskDetail) {
  let current: TaskDetailComposer;
  function Probe({ taskDetail }: { taskDetail: TaskDetail }) {
    current = useTaskDetailComposer({ api, taskId: "task", taskProjectId: "project", taskRootPath: null,
      taskDetail, workspaceMemoryEnabled: true, user: null, availableAgents: agents, defaultAgentId: "gpt" });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<Probe taskDetail={initialDetail} />));
  return {
    current: () => current!,
    rerender: (taskDetail: TaskDetail) => act(() => root!.render(<Probe taskDetail={taskDetail} />))
  };
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

describe("task follow-up setup", () => {
  it("inherits message setup from a message-free snapshot and detects cache-breaking changes", () => {
    writeTaskInputDrafts(updateTaskInputDraftForProject({}, "project", (draft) => ({
      ...draft, agentId: "gpt", toolOptions: { ...draft.toolOptions, webSearch: false, memorySearch: true }
    })));
    const view = renderComposer(detail("m1"));
    expect(view.current().selectedAgentId).toBe("opus");
    expect(view.current().toolOptions).toMatchObject({ webSearch: true, memorySearch: false });
    expect(view.current().latestSetup?.messageId).toBe("m1");

    act(() => view.current().handleAgentChange("gpt"));
    expect(findCacheBreakingChanges(view.current().latestSetup, {
      agentId: view.current().selectedAgentId, toolOptions: view.current().toolOptions
    })).toEqual(["agent"]);
  });

  it("keeps local edits through snapshot refreshes and adopts setup after a new user message", () => {
    const view = renderComposer(detail("m1"));
    act(() => {
      view.current().handleAgentChange("gpt");
      view.current().handleToolOptionsChange({ ...view.current().toolOptions, computerUse: true });
    });
    view.rerender(detail("m1"));
    expect(view.current().selectedAgentId).toBe("gpt");
    expect(view.current().toolOptions.computerUse).toBe(true);

    view.rerender(detail("m2", false));
    expect(view.current().latestSetup?.messageId).toBe("m2");
    expect(view.current().selectedAgentId).toBe("opus");
    expect(view.current().toolOptions).toMatchObject({ webSearch: false, computerUse: false });
  });
});
