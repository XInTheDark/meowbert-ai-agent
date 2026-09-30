/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type {
  TaskConversationPageResponse,
  TaskMessage,
  TaskMessageContentBatchResponse
} from "../../../lib/types";
import { useTaskDetailConversation } from "./useTaskDetailConversation";
import { MESSAGE_MAX_WINDOW_ITEMS } from "./taskDetailConstants";

function defineMutableNumberProperty(target: object, key: string, initialValue: number): void {
  let value = initialValue;
  Object.defineProperty(target, key, {
    configurable: true,
    get: () => value,
    set: (nextValue: number) => {
      value = nextValue;
    }
  });
}

function defineRect(target: Element, top: number, height = 48): void {
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: top,
      top,
      bottom: top + height,
      left: 0,
      right: 400,
      width: 400,
      height,
      toJSON: () => undefined
    })
  });
}

function buildMessage(id: string): TaskMessage {
  return {
    id,
    role: "user",
    content_json: { text: id },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: "2026-04-25T00:00:00.000Z"
  };
}

function buildToolMessage(id: string, contentJson: TaskMessage["content_json"]): TaskMessage {
  return {
    id,
    role: "tool",
    content_json: contentJson,
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: "2026-04-25T00:00:00.000Z"
  };
}

function buildConversationPage(messages: TaskMessage[]): TaskConversationPageResponse {
  return {
    active_leaf_message_id: messages[messages.length - 1]?.id ?? null,
    messages,
    message_page: {
      start_index: 0,
      end_index: messages.length,
      total_items: messages.length,
      has_older: false,
      has_newer: false
    },
    branch_options: {}
  };
}

function buildConversationPageForLeaf(messages: TaskMessage[], activeLeafMessageId: string | null): TaskConversationPageResponse {
  return {
    ...buildConversationPage(messages),
    active_leaf_message_id: activeLeafMessageId
  };
}

function buildApi(messages: TaskMessage[], contentMessages: TaskMessage[] = messages): ApiClient {
  return {
    get: vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
      expect(path.startsWith("/api/tasks/task-1/conversation?limit=50")).toBe(true);
      return buildConversationPage(messages);
    }) as ApiClient["get"],
    post: vi.fn(async (path: string, body?: unknown): Promise<TaskMessageContentBatchResponse> => {
      expect(path).toBe("/api/tasks/task-1/messages/content");
      const ids = Array.isArray((body as { ids?: unknown }).ids)
        ? (body as { ids: string[] }).ids
        : [];
      return { items: contentMessages.filter((message) => ids.includes(message.id)) };
    }) as ApiClient["post"],
    postForm: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    }
  };
}

function ConversationHarness(props: {
  api: ApiClient;
  activeLeafMessageId?: string | null;
  refreshVersion?: number;
  jumpMessageId?: string;
}) {
  const conversation = useTaskDetailConversation({
    api: props.api,
    taskId: "task-1",
    activeTab: "conversation",
    activeLeafMessageId: props.activeLeafMessageId ?? null,
    refreshVersion: props.refreshVersion ?? 0,
    isMobileViewport: false,
    isMobileInputExpanded: false
  });

  return (
    <div>
      <div data-testid="feed" ref={conversation.chatFeedRef}>
        {conversation.messages.map((message) => (
          <div key={message.id} data-message-id={message.id}>
            {message.id}:{JSON.stringify(message.content_json)}
          </div>
        ))}
      </div>
      <div data-testid="bootstrapping">{conversation.isConversationBootstrapping ? "yes" : "no"}</div>
      <div data-testid="hydrated-ids">{Array.from(conversation.hydratedMessageIds).sort().join(",")}</div>
      <div data-testid="message-page">
        {conversation.messagePage.start_index}:{conversation.messagePage.end_index}:{conversation.messagePage.total_items}
      </div>
      <button type="button" onClick={() => conversation.jumpToMessage(props.jumpMessageId ?? "message-2")}>
        Jump
      </button>
      <button type="button" onClick={() => conversation.handleToolGroupExpandRequested(["tool-1"])}>
        Expand tools
      </button>
      <button type="button" onClick={() => conversation.handleConversationScroll()}>
        Scroll
      </button>
      <button
        type="button"
        onClick={() => conversation.handleConversationWheel({ deltaY: -100 } as unknown as React.WheelEvent<HTMLDivElement>)}
      >
        Wheel up
      </button>
      <button
        type="button"
        onClick={() => conversation.handleConversationWheel({ deltaY: 100 } as unknown as React.WheelEvent<HTMLDivElement>)}
      >
        Wheel down
      </button>
    </div>
  );
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useTaskDetailConversation", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
  });

  it("scrolls when jumping to an already-rendered message", async () => {
    const messages = [buildMessage("message-1"), buildMessage("message-2"), buildMessage("message-3")];
    const api = buildApi(messages);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const target = container.querySelector<HTMLElement>('[data-message-id="message-2"]');
    const jumpButton = container.querySelector<HTMLButtonElement>("button");
    expect(feed).toBeTruthy();
    expect(target).toBeTruthy();
    expect(jumpButton).toBeTruthy();

    defineMutableNumberProperty(feed!, "scrollTop", 100);
    defineMutableNumberProperty(feed!, "clientHeight", 300);
    defineMutableNumberProperty(feed!, "scrollHeight", 1000);
    defineRect(feed!, 10, 300);
    defineRect(target!, 290, 48);
    const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === "object" && typeof options.top === "number") {
        feed!.scrollTop = options.top;
      }
    });
    feed!.scrollTo = scrollTo as HTMLDivElement["scrollTo"];

    await act(async () => {
      jumpButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    expect(scrollTo).toHaveBeenCalledWith({
      top: 356,
      behavior: "auto"
    });
  });

  it("loads a window around an unloaded jump target", async () => {
    const initialMessages = [buildMessage("message-51"), buildMessage("message-52"), buildMessage("message-53")];
    const targetMessages = [buildMessage("message-10"), buildMessage("message-11"), buildMessage("message-12")];
    const api = {
      ...buildApi(initialMessages),
      get: vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
        expect(path.startsWith("/api/tasks/task-1/conversation?limit=50")).toBe(true);
        if (path.includes("targetMessageId=message-10")) {
          return {
            ...buildConversationPage(targetMessages),
            message_page: {
              start_index: 9,
              end_index: 12,
              total_items: 60,
              has_older: true,
              has_newer: true
            }
          };
        }

        return {
          ...buildConversationPage(initialMessages),
          message_page: {
            start_index: 50,
            end_index: 53,
            total_items: 60,
            has_older: true,
            has_newer: true
          }
        };
      }) as ApiClient["get"]
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} jumpMessageId="message-10" />);
      await flushPromises();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const jumpButton = container.querySelector<HTMLButtonElement>("button");
    expect(feed).toBeTruthy();
    expect(jumpButton).toBeTruthy();

    await act(async () => {
      jumpButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    const target = container.querySelector<HTMLElement>('[data-message-id="message-10"]');
    expect(target).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("/api/tasks/task-1/conversation?limit=50&targetMessageId=message-10");
  });

  it("anchors the initial conversation window to the final message", async () => {
    vi.useFakeTimers();
    const messages = [buildMessage("message-1"), buildMessage("message-2"), buildMessage("message-3")];
    const api = buildApi(messages);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const target = container.querySelector<HTMLElement>('[data-message-id="message-3"]');
    expect(feed).toBeTruthy();
    expect(target).toBeTruthy();

    defineMutableNumberProperty(feed!, "scrollTop", 100);
    defineMutableNumberProperty(feed!, "clientHeight", 300);
    defineMutableNumberProperty(feed!, "scrollHeight", 1000);
    defineRect(feed!, 10, 300);
    defineRect(target!, 590, 48);
    const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === "object" && typeof options.top === "number") {
        feed!.scrollTop = options.top;
      }
    });
    feed!.scrollTo = scrollTo as HTMLDivElement["scrollTo"];

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
      await flushPromises();
    });

    expect(scrollTo).toHaveBeenCalledWith({
      top: 656,
      behavior: "auto"
    });
  });

  it("keeps the current conversation visible while refreshing for a new active leaf", async () => {
    const initialMessages = [buildMessage("message-1")];
    const refreshedMessages = [buildMessage("message-1"), buildMessage("message-2")];
    const refresh = createDeferred<TaskConversationPageResponse>();
    const get = vi.fn((path: string): Promise<TaskConversationPageResponse> => {
      if (get.mock.calls.length === 1) {
        expect(path).toBe("/api/tasks/task-1/conversation?limit=50&activeLeafMessageId=leaf-1");
        return Promise.resolve(buildConversationPageForLeaf(initialMessages, "leaf-1"));
      }

      expect(path).toBe("/api/tasks/task-1/conversation?limit=50&activeLeafMessageId=leaf-2");
      return refresh.promise;
    });
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} activeLeafMessageId="leaf-1" />);
      await flushPromises();
    });

    expect(container.textContent).toContain("message-1");
    expect(container.querySelector('[data-testid="bootstrapping"]')?.textContent).toBe("no");

    await act(async () => {
      root?.render(<ConversationHarness api={api} activeLeafMessageId="leaf-2" />);
      await flushPromises();
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("message-1");
    expect(container.textContent).not.toContain("message-2");
    expect(container.querySelector('[data-testid="bootstrapping"]')?.textContent).toBe("no");

    await act(async () => {
      refresh.resolve(buildConversationPageForLeaf(refreshedMessages, "leaf-2"));
      await flushPromises();
    });

    expect(container.textContent).toContain("message-1");
    expect(container.textContent).toContain("message-2");
  });

  it("refreshes the latest conversation window when requested", async () => {
    const initialMessages = [buildMessage("message-1")];
    const refreshedMessages = [buildMessage("message-1"), buildMessage("message-2")];
    const get = vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
      expect(path).toBe("/api/tasks/task-1/conversation?limit=50");
      return get.mock.calls.length === 1
        ? buildConversationPage(initialMessages)
        : buildConversationPage(refreshedMessages);
    });
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} refreshVersion={0} />);
      await flushPromises();
    });

    expect(container.textContent).toContain("message-1");
    expect(container.textContent).not.toContain("message-2");
    expect(container.querySelector('[data-testid="bootstrapping"]')?.textContent).toBe("no");

    await act(async () => {
      root?.render(<ConversationHarness api={api} refreshVersion={1} />);
      await flushPromises();
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("message-1");
    expect(container.textContent).toContain("message-2");
    expect(container.querySelector('[data-testid="bootstrapping"]')?.textContent).toBe("no");
  });

  it("does not jump to the latest message when refreshing while scrolled up", async () => {
    vi.useFakeTimers();
    const initialMessages = [buildMessage("message-1")];
    const refreshedMessages = [buildMessage("message-1"), buildMessage("message-2")];
    const get = vi.fn(async (): Promise<TaskConversationPageResponse> => (
      get.mock.calls.length === 1
        ? buildConversationPage(initialMessages)
        : buildConversationPage(refreshedMessages)
    ));
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} refreshVersion={0} />);
      await flushPromises();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const scrollButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Scroll");
    expect(feed).toBeTruthy();
    expect(scrollButton).toBeTruthy();

    defineMutableNumberProperty(feed!, "scrollTop", 100);
    defineMutableNumberProperty(feed!, "clientHeight", 300);
    defineMutableNumberProperty(feed!, "scrollHeight", 1000);
    const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === "object" && typeof options.top === "number") {
        feed!.scrollTop = options.top;
      }
    });
    feed!.scrollTo = scrollTo as HTMLDivElement["scrollTo"];

    await act(async () => {
      vi.runAllTimers();
      scrollButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    feed!.scrollTop = 100;
    scrollTo.mockClear();

    await act(async () => {
      root?.render(<ConversationHarness api={api} refreshVersion={1} />);
      await flushPromises();
      vi.runAllTimers();
    });

    expect(container.textContent).toContain("message-2");
    expect(feed!.scrollTop).toBe(100);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("caps the mounted conversation window when loading newer messages", async () => {
    vi.useFakeTimers();
    const initialCount = MESSAGE_MAX_WINDOW_ITEMS + 50;
    const newerCount = 60;
    const totalItems = initialCount + newerCount;
    const initialMessages = Array.from({ length: initialCount }, (_, index) => buildMessage(`message-${index}`));
    const newerMessages = Array.from({ length: newerCount }, (_, index) => buildMessage(`message-${initialCount + index}`));
    const get = vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
      if (get.mock.calls.length === 1) {
        expect(path).toBe("/api/tasks/task-1/conversation?limit=50");
        return {
          ...buildConversationPage(initialMessages),
          message_page: {
            start_index: 0,
            end_index: initialCount,
            total_items: totalItems,
            has_older: false,
            has_newer: true
          }
        };
      }

      expect(path).toBe(`/api/tasks/task-1/conversation?limit=50&afterIndex=${initialCount - 1}`);
      return {
        ...buildConversationPage(newerMessages),
        message_page: {
          start_index: initialCount,
          end_index: totalItems,
          total_items: totalItems,
          has_older: true,
          has_newer: false
        }
      };
    });
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
      await flushPromises();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const scrollButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Scroll");
    expect(feed).toBeTruthy();
    expect(scrollButton).toBeTruthy();
    defineMutableNumberProperty(feed!, "scrollTop", 900);
    defineMutableNumberProperty(feed!, "clientHeight", 100);
    defineMutableNumberProperty(feed!, "scrollHeight", 1000);

    await act(async () => {
      scrollButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    const expectedStartIndex = totalItems - MESSAGE_MAX_WINDOW_ITEMS;
    expect(get).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll("[data-message-id]")).toHaveLength(MESSAGE_MAX_WINDOW_ITEMS);
    expect(container.querySelector('[data-message-id="message-0"]')).toBeNull();
    expect(container.querySelector(`[data-message-id="message-${expectedStartIndex}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-message-id="message-${totalItems - 1}"]`)).toBeTruthy();
    expect(container.querySelector('[data-testid="message-page"]')?.textContent).toBe(`${expectedStartIndex}:${totalItems}:${totalItems}`);
  });

  it("keeps recently loaded newer messages available after reaching the oldest page", async () => {
    vi.useFakeTimers();
    const totalItems = MESSAGE_MAX_WINDOW_ITEMS + 100;
    const initialStart = MESSAGE_MAX_WINDOW_ITEMS + 50;
    const allMessages = Array.from({ length: totalItems }, (_, index) => buildMessage(`message-${index}`));
    const get = vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
      const query = new URL(`https://example.test${path}`).searchParams;
      const beforeIndex = query.get("beforeIndex");
      const afterIndex = query.get("afterIndex");
      let startIndex = initialStart;
      let endIndex = totalItems;
      if (beforeIndex !== null) {
        endIndex = Number.parseInt(beforeIndex, 10);
        startIndex = Math.max(0, endIndex - 50);
      } else if (afterIndex !== null) {
        startIndex = Number.parseInt(afterIndex, 10) + 1;
        endIndex = Math.min(totalItems, startIndex + 50);
      }
      return {
        ...buildConversationPage(allMessages.slice(startIndex, endIndex)),
        active_leaf_message_id: `message-${totalItems - 1}`,
        message_page: {
          start_index: startIndex,
          end_index: endIndex,
          total_items: totalItems,
          has_older: startIndex > 0,
          has_newer: endIndex < totalItems
        }
      };
    });
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const scrollButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Scroll");
    expect(feed).toBeTruthy();
    expect(scrollButton).toBeTruthy();
    defineMutableNumberProperty(feed!, "scrollTop", 0);
    defineMutableNumberProperty(feed!, "clientHeight", 100);
    defineMutableNumberProperty(feed!, "scrollHeight", 1_000);

    const pagesToOldest = Math.ceil(initialStart / 50);
    for (let page = 0; page < pagesToOldest; page += 1) {
      await act(async () => {
        feed!.scrollTop = 0;
        scrollButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushPromises();
      });
    }

    expect(container.querySelector('[data-testid="message-page"]')?.textContent).toBe(`0:${MESSAGE_MAX_WINDOW_ITEMS}:${totalItems}`);
    expect(container.querySelector(`[data-message-id="message-${MESSAGE_MAX_WINDOW_ITEMS - 1}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-message-id="message-${MESSAGE_MAX_WINDOW_ITEMS}"]`)).toBeNull();

    await act(async () => {
      feed!.scrollTop = 900;
      scrollButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    expect(get).toHaveBeenCalledTimes(pagesToOldest + 2);
    expect(container.querySelector('[data-testid="message-page"]')?.textContent).toBe(`50:${MESSAGE_MAX_WINDOW_ITEMS + 50}:${totalItems}`);
    expect(container.querySelector('[data-message-id="message-50"]')).toBeTruthy();
    expect(container.querySelector(`[data-message-id="message-${MESSAGE_MAX_WINDOW_ITEMS + 49}"]`)).toBeTruthy();
  });

  it("does not keep rewriting the scroll position after prepending older messages", async () => {
    vi.useFakeTimers();
    const initialMessages = Array.from({ length: 50 }, (_, index) => buildMessage(`message-${50 + index}`));
    const olderToolSummary = buildToolMessage("tool-older", { tool: "summary" });
    const olderToolFull = buildToolMessage("tool-older", {
      tool: "summary",
      output: "hydrated content"
    });
    const olderMessages = [
      olderToolSummary,
      ...Array.from({ length: 49 }, (_, index) => buildMessage(`message-${index + 1}`))
    ];
    const olderPage = createDeferred<TaskConversationPageResponse>();
    const hydration = createDeferred<TaskMessageContentBatchResponse>();
    const get = vi.fn((path: string): Promise<TaskConversationPageResponse> => {
      if (get.mock.calls.length === 1) {
        expect(path).toBe("/api/tasks/task-1/conversation?limit=50");
        return Promise.resolve({
          ...buildConversationPage(initialMessages),
          message_page: {
            start_index: 50,
            end_index: 100,
            total_items: 100,
            has_older: true,
            has_newer: false
          }
        });
      }

      expect(path).toBe("/api/tasks/task-1/conversation?limit=50&beforeIndex=50");
      return olderPage.promise;
    });
    const olderPageResponse: TaskConversationPageResponse = {
      ...buildConversationPage(olderMessages),
      message_page: {
        start_index: 0,
        end_index: 50,
        total_items: 100,
        has_older: false,
        has_newer: true
      }
    };
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => hydration.promise) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
      await flushPromises();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const scrollButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Scroll");
    expect(feed).toBeTruthy();
    expect(scrollButton).toBeTruthy();
    defineMutableNumberProperty(feed!, "scrollTop", 0);
    defineMutableNumberProperty(feed!, "clientHeight", 300);
    let scrollHeightOverride: number | null = null;
    Object.defineProperty(feed!, "scrollHeight", {
      configurable: true,
      get: () => scrollHeightOverride ?? (feed!.querySelectorAll("[data-message-id]").length > 50 ? 1600 : 1000),
      set: (nextValue: number) => {
        scrollHeightOverride = nextValue;
      }
    });

    await act(async () => {
      scrollButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    expect(get).toHaveBeenCalledTimes(2);

    await act(async () => {
      olderPage.resolve(olderPageResponse);
      await flushPromises();
    });

    expect(feed!.scrollTop).toBe(600);

    feed!.scrollTop = 520;
    scrollHeightOverride = 1900;
    await act(async () => {
      hydration.resolve({ items: [olderToolFull] });
      await flushPromises();
    });

    expect(feed!.scrollTop).toBe(520);
    expect(container.textContent).toContain("hydrated content");
  });

  it("stops bottom alignment when the user scrolls away", async () => {
    vi.useFakeTimers();
    const toolSummary = buildToolMessage("tool-1", { tool: "summary" });
    const toolFull = buildToolMessage("tool-1", {
      tool: "summary",
      output: "hydrated content"
    });
    const hydration = createDeferred<TaskMessageContentBatchResponse>();
    const api: ApiClient = {
      ...buildApi([toolSummary]),
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => hydration.promise) as ApiClient["post"]
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const scrollButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Scroll");
    expect(feed).toBeTruthy();
    expect(scrollButton).toBeTruthy();

    defineMutableNumberProperty(feed!, "scrollTop", 700);
    defineMutableNumberProperty(feed!, "clientHeight", 300);
    defineMutableNumberProperty(feed!, "scrollHeight", 1000);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    feed!.scrollTop = 700;
    await act(async () => {
      scrollButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      hydration.resolve({ items: [toolFull] });
      await flushPromises();
      await flushPromises();
    });

    expect(container.textContent).toContain("hydrated content");
    expect(feed!.scrollTop).toBe(700);

    feed!.scrollTop = 400;
    await act(async () => {
      scrollButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.runAllTimersAsync();
    });

    expect(feed!.scrollTop).toBe(400);
  });

  it("does not mark metadata-only historical tool messages as hydrated until full content loads", async () => {
    const metadataTool: TaskMessage = {
      id: "tool-1",
      role: "tool",
      content_json: {
        tool: "image-generation generate image",
        durationMs: 358
      },
      parent_message_id: "message-1",
      edited_from_message_id: null,
      created_at: "2026-04-25T00:00:01.000Z"
    };
    const fullTool: TaskMessage = {
      ...metadataTool,
      content_json: {
        ...metadataTool.content_json,
        response_custom_tool_call: {
          type: "custom_tool_call",
          call_id: "call-image-1",
          name: "image-generation__generate_image",
          input: "{\"prompt\":\"cat\"}"
        },
        response_custom_tool_output: {
          type: "custom_tool_call_output",
          call_id: "call-image-1",
          output: "{\"path\":\"outputs/cat.png\"}"
        }
      }
    };
    const messages = [
      buildMessage("message-1"),
      metadataTool,
      buildMessage("message-2")
    ];
    const api = buildApi(messages, [fullTool]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });

    expect(container.querySelector('[data-testid="hydrated-ids"]')?.textContent).toBe("message-1,message-2");
    expect(container.textContent).toContain("\"durationMs\":358");
    expect(container.textContent).not.toContain("response_custom_tool_call");

    const expandButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Expand tools");
    expect(expandButton).toBeTruthy();

    await act(async () => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    expect(api.post).toHaveBeenCalledWith("/api/tasks/task-1/messages/content", { ids: ["tool-1"] });
    expect(container.querySelector('[data-testid="hydrated-ids"]')?.textContent).toBe("message-1,message-2,tool-1");
    expect(container.textContent).toContain("response_custom_tool_call");
    expect(container.textContent).toContain("outputs/cat.png");
  });

  it("auto-loads older messages when the rendered conversation does not fill the container height", async () => {
    vi.useFakeTimers();
    const initialMessages = Array.from({ length: 50 }, (_, index) => buildMessage(`message-${50 + index}`));
    const olderMessages = Array.from({ length: 50 }, (_, index) => buildMessage(`message-${index}`));
    const get = vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
      if (get.mock.calls.length === 1) {
        expect(path).toBe("/api/tasks/task-1/conversation?limit=50");
        return {
          ...buildConversationPage(initialMessages),
          message_page: {
            start_index: 50,
            end_index: 100,
            total_items: 100,
            has_older: true,
            has_newer: false
          }
        };
      }

      expect(path).toBe("/api/tasks/task-1/conversation?limit=50&beforeIndex=50");
      return {
        ...buildConversationPage(olderMessages),
        message_page: {
          start_index: 0,
          end_index: 50,
          total_items: 100,
          has_older: false,
          has_newer: true
        }
      };
    });
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 800
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 150
    });

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(<ConversationHarness api={api} />);
        await flushPromises();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
        await flushPromises();
      });

      expect(get).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("message-0");
      expect(container.textContent).toContain("message-99");
      expect(container.querySelector('[data-testid="message-page"]')?.textContent).toBe("0:100:100");
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      } else {
        delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
      }
    }
  });

  it("loads older messages on wheel up when the feed is near top or not full", async () => {
    vi.useFakeTimers();
    const initialMessages = Array.from({ length: 50 }, (_, index) => buildMessage(`message-${50 + index}`));
    const olderMessages = Array.from({ length: 50 }, (_, index) => buildMessage(`message-${index}`));
    const get = vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
      if (get.mock.calls.length === 1) {
        return {
          ...buildConversationPage(initialMessages),
          message_page: {
            start_index: 50,
            end_index: 100,
            total_items: 100,
            has_older: true,
            has_newer: false
          }
        };
      }

      return {
        ...buildConversationPage(olderMessages),
        message_page: {
          start_index: 0,
          end_index: 50,
          total_items: 100,
          has_older: false,
          has_newer: true
        }
      };
    });
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const wheelButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Wheel up");
    expect(feed).toBeTruthy();
    expect(wheelButton).toBeTruthy();

    defineMutableNumberProperty(feed!, "scrollTop", 50);
    defineMutableNumberProperty(feed!, "clientHeight", 400);
    defineMutableNumberProperty(feed!, "scrollHeight", 800);

    await act(async () => {
      wheelButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await vi.runAllTimersAsync();
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("message-0");
  });

  it("does not load older messages when scrolling down in a short feed with older messages", async () => {
    vi.useFakeTimers();
    const initialMessages = Array.from({ length: 50 }, (_, index) => buildMessage(`message-${50 + index}`));
    const get = vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
      expect(path).toBe("/api/tasks/task-1/conversation?limit=50");
      return {
        ...buildConversationPage(initialMessages),
        message_page: {
          start_index: 50,
          end_index: 100,
          total_items: 100,
          has_older: true,
          has_newer: false
        }
      };
    });
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const scrollButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Scroll");
    expect(feed).toBeTruthy();
    expect(scrollButton).toBeTruthy();

    defineMutableNumberProperty(feed!, "scrollTop", 50);
    defineMutableNumberProperty(feed!, "clientHeight", 800);
    defineMutableNumberProperty(feed!, "scrollHeight", 900);

    // Initial scroll position recorded at 50
    await act(async () => {
      scrollButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });
    expect(get).toHaveBeenCalledTimes(1);

    // User scrolls down to 100 (which is <= 200 SCROLL_EDGE_THRESHOLD_PX)
    feed!.scrollTop = 100;
    await act(async () => {
      scrollButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    // Must NOT have called API to load older messages
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("loads newer messages on wheel down when has_newer is true", async () => {
    vi.useFakeTimers();
    const initialMessages = Array.from({ length: 50 }, (_, index) => buildMessage(`message-${index}`));
    const newerMessages = Array.from({ length: 50 }, (_, index) => buildMessage(`message-${50 + index}`));
    const get = vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
      if (get.mock.calls.length === 1) {
        return {
          ...buildConversationPage(initialMessages),
          message_page: {
            start_index: 0,
            end_index: 50,
            total_items: 100,
            has_older: false,
            has_newer: true
          }
        };
      }

      expect(path).toBe("/api/tasks/task-1/conversation?limit=50&afterIndex=49");
      return {
        ...buildConversationPage(newerMessages),
        message_page: {
          start_index: 50,
          end_index: 100,
          total_items: 100,
          has_older: true,
          has_newer: false
        }
      };
    });
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ConversationHarness api={api} />);
      await flushPromises();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const feed = container.querySelector<HTMLDivElement>('[data-testid="feed"]');
    const wheelDownButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Wheel down");
    expect(feed).toBeTruthy();
    expect(wheelDownButton).toBeTruthy();

    defineMutableNumberProperty(feed!, "scrollTop", 0);
    defineMutableNumberProperty(feed!, "clientHeight", 800);
    defineMutableNumberProperty(feed!, "scrollHeight", 400);

    await act(async () => {
      wheelDownButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await vi.runAllTimersAsync();
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("message-99");
  });

  it("does not auto-load older messages when has_newer is true", async () => {
    vi.useFakeTimers();
    const initialMessages = Array.from({ length: 50 }, (_, index) => buildMessage(`message-${index}`));
    const get = vi.fn(async (path: string): Promise<TaskConversationPageResponse> => {
      expect(path).toBe("/api/tasks/task-1/conversation?limit=50");
      return {
        ...buildConversationPage(initialMessages),
        message_page: {
          start_index: 0,
          end_index: 50,
          total_items: 100,
          has_older: true,
          has_newer: true
        }
      };
    });
    const api: ApiClient = {
      get: get as ApiClient["get"],
      post: vi.fn(async (): Promise<TaskMessageContentBatchResponse> => ({ items: [] })) as ApiClient["post"],
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 800
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 150
    });

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(<ConversationHarness api={api} />);
        await flushPromises();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
        await flushPromises();
      });

      // Must only be called once (bootstrap), NOT auto-filling older because has_newer is true
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      } else {
        delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
      }
    }
  });
});
