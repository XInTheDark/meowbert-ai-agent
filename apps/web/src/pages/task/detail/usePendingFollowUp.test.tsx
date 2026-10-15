/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskMessage } from "../../../lib/types";
import { usePendingFollowUp, type PendingFollowUpControls } from "./usePendingFollowUp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function userMessage(id: string): TaskMessage {
  return {
    id,
    role: "user",
    content_json: { text: "hello" },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: new Date(0).toISOString()
  };
}

let root: Root | null = null;

function renderPending(initialMessages: TaskMessage[]) {
  const container = document.createElement("div");
  let latest: PendingFollowUpControls | null = null;
  function Probe(props: { messages: TaskMessage[] }) {
    latest = usePendingFollowUp("task-1", props.messages);
    return null;
  }
  root = createRoot(container);
  act(() => root!.render(<Probe messages={initialMessages} />));
  return {
    current: () => latest!,
    rerender: (messages: TaskMessage[]) => act(() => root!.render(<Probe messages={messages} />))
  };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("usePendingFollowUp", () => {
  it("keeps the pending message until the conversation loads the stored copy", () => {
    const view = renderPending([userMessage("m1")]);

    act(() => view.current().begin("hello"));
    act(() => view.current().confirm("m2"));
    expect(view.current().text).toBe("hello");

    view.rerender([userMessage("m1"), userMessage("m2")]);
    expect(view.current().text).toBeNull();
  });

  it("drops the pending message when the send fails or returns no message id", () => {
    const view = renderPending([]);

    act(() => view.current().begin("hello"));
    act(() => view.current().clear());
    expect(view.current().text).toBeNull();

    act(() => view.current().begin("again"));
    act(() => view.current().confirm(null));
    expect(view.current().text).toBeNull();
  });
});
