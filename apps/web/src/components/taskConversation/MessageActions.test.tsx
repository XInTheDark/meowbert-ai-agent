import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspaceApp: () => ({
    api: {
      post: vi.fn()
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
