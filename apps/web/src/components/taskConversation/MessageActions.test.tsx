/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspaceApp: () => ({
    api: {
      post: mocks.post
    }
  })
}));

import { MessageActions } from "./MessageActions";
import type { TaskMessage } from "../../lib/types";

function renderMessageActions(message: TaskMessage): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MessageActions taskId="task-1" message={message} />
    </MemoryRouter>
  );
}

describe("MessageActions", () => {
  it("shows a continue action for assistant messages", () => {
    const html = renderMessageActions({
      id: "assistant-1",
      role: "assistant",
      content_json: { text: "Partial reply" },
      parent_message_id: "user-1",
      edited_from_message_id: null,
      created_at: "2026-03-11T00:00:00.000Z"
    });

    expect(html).toContain("title=\"Continue from here\"");
    expect(html).toContain("title=\"Metadata\"");
    expect(html).toContain("title=\"Retry from here\"");
    expect(html).toContain("title=\"Fork from here\"");
  });

  it("keeps continue hidden for user messages", () => {
    const html = renderMessageActions({
      id: "user-1",
      role: "user",
      content_json: { text: "hello" },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-11T00:00:00.000Z"
    });

    expect(html).not.toContain("title=\"Continue from here\"");
    expect(html).toContain("title=\"Metadata\"");
    expect(html).toContain("title=\"Retry from here\"");
    expect(html).toContain("title=\"Fork from here\"");
  });

  it("renders custom data-tooltip attributes on action buttons", () => {
    const html = renderMessageActions({
      id: "assistant-1",
      role: "assistant",
      content_json: { text: "Partial reply" },
      parent_message_id: "user-1",
      edited_from_message_id: null,
      created_at: "2026-03-11T00:00:00.000Z"
    });

    expect(html).toContain("data-tooltip=\"Copy message\"");
    expect(html).toContain("data-tooltip=\"Message details\"");
    expect(html).toContain("data-tooltip=\"Continue response\"");
    expect(html).toContain("data-tooltip=\"Retry response\"");
    expect(html).toContain("data-tooltip=\"Fork branch\"");
  });
});


it.each(["/app/ws/projects/project", "/app/ws/projects/project/tasks/master"])("navigates a fork from %s", async (pathname) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.post.mockResolvedValue({ taskId: "forked-task" });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }
  try {
    await act(async () => { root.render(<MemoryRouter initialEntries={[pathname]}>
      <MessageActions taskId="master" message={{ id: "m", role: "assistant", content_json: { text: "Reply" }, parent_message_id: null, edited_from_message_id: null, created_at: "2026-11-20T00:00:00Z" }} />
      <Location />
    </MemoryRouter>); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Fork branch"]')!.click(); });
    await act(async () => { document.querySelector<HTMLFormElement>(".task-fork-dialog")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.querySelector('[data-testid="location"]')!.textContent).toBe("/app/ws/projects/project/tasks/forked-task");
    expect(mocks.post).toHaveBeenCalledWith("/api/tasks/master/fork", { messageId: "m", copyTaskFiles: true });
  } finally { await act(async () => { root.unmount(); }); container.remove(); }
});
