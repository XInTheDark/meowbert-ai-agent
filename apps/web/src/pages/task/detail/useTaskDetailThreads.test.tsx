/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { PlatformCapabilities } from "../../../desktop/platform";
import type { TaskToolOptions } from "../../../lib/types";
import { useTaskDetailThreads } from "./useTaskDetailThreads";

vi.mock("../../../task/taskThreads", () => ({
  createTaskThread: vi.fn(async () => ({ taskId: "thread-1" })),
  listTaskThreads: vi.fn(async () => [])
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const api = {} as ApiClient;
const toolOptions = {} as TaskToolOptions;
const capabilities = { isDesktop: false } as PlatformCapabilities;

function renderThreads(revealMessage = vi.fn()) {
  let current: ReturnType<typeof useTaskDetailThreads> | null = null;
  function Harness() {
    current = useTaskDetailThreads({
      api,
      taskId: "task-root",
      taskRootPath: null,
      taskDetail: null,
      switchToConversation: () => undefined,
      revealMessage,
      invalidateCurrentTaskCache: () => undefined,
      loadTask: async () => undefined,
      toolOptions,
      workspaceMemoryEnabled: false,
      capabilities,
      selectedAgentId: null,
      setMobileInputExpanded: () => undefined
    });
    return null;
  }
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(<Harness />));
  return { revealMessage, get: () => current! };
}

describe("useTaskDetailThreads", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it("opens a newly created selection thread without moving the main conversation", async () => {
    const { revealMessage, get } = renderThreads();

    await act(async () => {
      await get().handleSubmitSelectionThread({ messageId: "m-1", text: "quoted", location: null }, "why?");
    });

    expect(revealMessage).not.toHaveBeenCalled();
    expect(get().threadSidebarStack).toEqual([{ kind: "conversation", taskId: "thread-1" }]);
  });

  it("reveals the parent only when it belongs to the main conversation", () => {
    const { revealMessage, get } = renderThreads();

    act(() => get().openThreadConversation("thread-2", { parentTaskId: "thread-1", parentMessageId: "nested-m" }));
    expect(revealMessage).not.toHaveBeenCalled();

    act(() => get().openThreadConversation("thread-3", { parentTaskId: "task-root", parentMessageId: "m-1" }));
    expect(revealMessage).toHaveBeenCalledWith("m-1", undefined);
  });
});
