import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { TaskMessage } from "../../lib/types";
import { TaskConversationMessages } from "./TaskConversationMessages";

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspaceApp: () => ({ api: { post: vi.fn() } })
}));

function createMessage(input: {
  id: string;
  role: TaskMessage["role"];
  content: Record<string, unknown>;
  createdAt?: string;
}): TaskMessage {
  return {
    id: input.id,
    role: input.role,
    content_json: input.content,
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: input.createdAt ?? "2026-09-11T00:00:00.000Z"
  };
}

function renderMessages(props: {
  messages: TaskMessage[];
  branchedIds?: Set<string>;
  isTaskRunning?: boolean;
  showMessageActions?: boolean;
}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <TaskConversationMessages
        taskId="task-1"
        messages={props.messages}
        showMessageActions={props.showMessageActions ?? true}
        isTaskRunning={props.isTaskRunning ?? false}
        renderBranchSwitcher={(message) => props.branchedIds?.has(message.id) ? (
          <div className="branch-switcher" data-branch-for={message.id}>Branch 1/2</div>
        ) : null}
      />
    </MemoryRouter>
  );
}

function extractFooterOnlyHtml(html: string): string {
  const marker = 'class="chat-bubble assistant assistant-footer-only"';
  const index = html.indexOf(marker);
  return index >= 0 ? html.slice(index) : "";
}

describe("empty-text assistant response footer and branch switcher", () => {
  const userMsg = createMessage({ id: "user-1", role: "user", content: { text: "Please grade this." } });
  const toolMsg = createMessage({ id: "tool-1", role: "tool", content: { tool: "run_shell", command: "ls", durationMs: 1200 } });
  const emptyAssistant = createMessage({ id: "assistant-empty", role: "assistant", content: { text: "" } });

  it("renders a footer bar with branch switcher and actions when an assistant response has no text", () => {
    const html = renderMessages({
      messages: [userMsg, toolMsg, emptyAssistant],
      branchedIds: new Set(["assistant-empty"])
    });
    const footerHtml = extractFooterOnlyHtml(html);

    expect(footerHtml).toContain("assistant-footer-only");
    expect(footerHtml).toContain('data-branch-for="assistant-empty"');
    expect(footerHtml).toContain("Branch 1/2");
    expect(footerHtml).toContain('title="Continue from here"');
    expect(footerHtml).toContain('title="Retry from here"');
    expect(footerHtml).toContain('title="Fork from here"');
    expect(footerHtml).not.toContain('title="Copy"');
  });

  it("surfaces a branch switcher on the footer bar when the branch split is on a tool message in a textless turn", () => {
    const html = renderMessages({
      messages: [userMsg, toolMsg],
      branchedIds: new Set(["tool-1"])
    });
    const footerHtml = extractFooterOnlyHtml(html);

    expect(footerHtml).toContain("assistant-footer-only");
    expect(footerHtml).toContain('data-branch-for="tool-1"');
    expect(footerHtml).toContain('title="Retry from here"');
    expect(footerHtml).toContain('title="Fork from here"');
    expect(footerHtml).not.toContain('title="Continue from here"');
  });

  it("keeps action buttons hidden on a running trailing turn while still exposing an existing branch switcher", () => {
    const runningWithoutBranches = renderMessages({
      messages: [userMsg, toolMsg],
      isTaskRunning: true
    });
    expect(runningWithoutBranches).not.toContain("assistant-footer-only");

    const runningWithBranches = renderMessages({
      messages: [userMsg, toolMsg],
      branchedIds: new Set(["tool-1"]),
      isTaskRunning: true
    });
    const footerHtml = extractFooterOnlyHtml(runningWithBranches);
    expect(footerHtml).toContain("assistant-footer-only");
    expect(footerHtml).toContain('data-branch-for="tool-1"');
    expect(footerHtml).not.toContain('title="Retry from here"');
  });

  it("attaches a tool-level branch switcher to the visible assistant reply without adding a duplicate footer", () => {
    const reply = createMessage({ id: "assistant-1", role: "assistant", content: { text: "Here is the feedback." } });
    const html = renderMessages({
      messages: [userMsg, toolMsg, reply],
      branchedIds: new Set(["tool-1"])
    });

    expect(html).not.toContain("assistant-footer-only");
    expect(html).toContain('data-branch-for="tool-1"');
    expect(html).toContain("Here is the feedback.");
  });
});
