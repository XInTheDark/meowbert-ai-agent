import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  buildStableHistoricalToolGroupDescriptors,
  getHistoricalToolGroupKey,
  TaskConversationMessages
} from "./TaskConversationMessages";
import { HistoricalConversationItems } from "./HistoricalConversationItems";
import type { TaskMessage } from "../../lib/types";

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspaceApp: () => ({
    api: {
      post: vi.fn()
    }
  })
}));

function createToolMessage(input: {
  id: string;
  createdAt: string;
  command: string;
  callId?: string;
}): TaskMessage {
  return {
    id: input.id,
    role: "tool",
    content_json: {
      tool: "run_shell",
      command: input.command,
      stdout: "done",
      durationMs: 1500,
      ...(input.callId ? { callId: input.callId } : {})
    },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: input.createdAt
  };
}

function createApplyPatchToolMessage(input: {
  id: string;
  createdAt: string;
  callId?: string;
  patch?: string;
}): TaskMessage {
  return {
    id: input.id,
    role: "tool",
    content_json: {
      tool: "apply_patch",
      callId: input.callId,
      inputLabel: "apply_patch",
      inputText: input.patch ?? "*** Begin Patch\n+hello\n*** End Patch",
      stdout: "Success",
      durationMs: 800
    },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: input.createdAt
  };
}

function createMessage(input: {
  id: string;
  role: TaskMessage["role"];
  createdAt: string;
  text: string;
  author?: TaskMessage["author"];
}): TaskMessage {
  return {
    id: input.id,
    role: input.role,
    content_json: { text: input.text },
    author: input.author,
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: input.createdAt
  };
}

describe("TaskConversationMessages", () => {
  it("hides citation markers only in assistant messages", () => {
    const marker = "citeturn2view3";
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TaskConversationMessages
          taskId="task-1"
          messages={[
            createMessage({ id: "user-1", role: "user", createdAt: "2026-03-10T00:00:01.000Z", text: `What is ${marker}?` }),
            createMessage({ id: "assistant-1", role: "assistant", createdAt: "2026-03-10T00:00:02.000Z", text: `Answer. ${marker}` })
          ]}
          hydratedMessageIds={new Set<string>()}
        />
      </MemoryRouter>
    );

    expect(html.match(/turn2view3/g)).toHaveLength(1);
    expect(html).toContain("Answer.");
  });

  it("renders assistant message actions and thread affordances in the task conversation", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TaskConversationMessages
          taskId="task-1"
          showMessageActions
          messages={[
            createMessage({
              id: "assistant-1",
              role: "assistant",
              createdAt: "2026-03-10T00:00:03.000Z",
              text: "Here is the answer."
            })
          ]}
          threadCountsByParentMessageId={{ "assistant-1": 2 }}
          onThreadComposerRequested={() => undefined}
          onThreadListRequested={() => undefined}
          hydratedMessageIds={new Set<string>()}
        />
      </MemoryRouter>
    );

    expect(html).toContain("message-actions");
    expect(html).toContain("title=\"Copy\"");
    expect(html).toContain("title=\"Continue from here\"");
    expect(html).toContain("title=\"Retry from here\"");
    expect(html).toContain("title=\"Fork from here\"");
    expect(html).toContain("assistant-selection-content");
    expect(html).toContain("title=\"Open 2 threads\"");
    expect(html).toContain("thread-icon-badge");
  });

  it("shows user message authors when enabled", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        showMessageAuthors
        messages={[
          createMessage({
            id: "user-1",
            role: "user",
            createdAt: "2026-03-10T00:00:00.000Z",
            text: "Please fix it.",
            author: {
              id: "user-1",
              email: "jerry@example.com",
              display_name: "Jerry"
            }
          })
        ]}
      />
    );

    expect(html).toContain("message-author-label");
    expect(html).toContain("Jerry");
  });

  it("hides user message authors by default", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          createMessage({
            id: "user-1",
            role: "user",
            createdAt: "2026-03-10T00:00:00.000Z",
            text: "Please fix it.",
            author: {
              id: "user-1",
              email: "jerry@example.com",
              display_name: "Jerry"
            }
          })
        ]}
      />
    );

    expect(html).not.toContain("message-author-label");
  });

  it("labels messages sent by the Project Master instead of the user", () => {
    const message = createMessage({
      id: "user-1",
      role: "user",
      createdAt: "2026-09-28T00:00:00.000Z",
      text: "Please also update the docs.",
      author: { id: "user-1", email: "jerry@example.com", display_name: "Jerry" }
    });
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[{ ...message, content_json: { ...message.content_json, sender: "project_master" } }]}
      />
    );

    expect(html).toContain("message-author-label");
    expect(html).toContain("Master");
    expect(html).not.toContain("Jerry");
  });

  it("wraps assistant messages with the text-selection thread target when enabled", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        taskId="task-1"
        messages={[
          createMessage({
            id: "assistant-1",
            role: "assistant",
            createdAt: "2026-03-10T00:00:03.000Z",
            text: "Select part of this answer."
          })
        ]}
        onThreadComposerRequested={() => undefined}
        enableThreadSelectionPopup
        hydratedMessageIds={new Set<string>()}
      />
    );

    expect(html).toContain("assistant-selection-content");
  });

  it("keeps actions and selection affordances on segmented assistant responses", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TaskConversationMessages
          taskId="task-1"
          showMessageActions
          messages={[
            {
              id: "assistant-segmented",
              role: "assistant",
              content_json: {
                text: "Intro text.\n\nAfter text.",
                response_items: [
                  {
                    type: "function_call",
                    id: "fc_partial_1",
                    call_id: "call_partial_1",
                    name: "final_response",
                    arguments: JSON.stringify({ response: "Intro text.", notify: true, partial: true }),
                    status: "completed"
                  },
                  {
                    type: "custom_tool_call",
                    id: "ctc_inline_1",
                    call_id: "call_inline_1",
                    name: "html_canvas_inline_artifact",
                    input: "{\"output_path\":\"reports/summary.html\"}"
                  },
                  {
                    type: "custom_tool_call_output",
                    call_id: "call_inline_1",
                    output: JSON.stringify({
                      ok: true,
                      inline_artifact: {
                        type: "html",
                        relative_path: "reports/summary.html",
                        title: "Summary"
                      }
                    })
                  },
                  {
                    type: "function_call",
                    id: "fc_final_1",
                    call_id: "call_final_1",
                    name: "final_response",
                    arguments: JSON.stringify({ response: "After text.", notify: true, partial: false }),
                    status: "completed"
                  }
                ]
              },
              parent_message_id: null,
              edited_from_message_id: null,
              created_at: "2026-03-10T00:00:03.000Z"
            }
          ]}
          onThreadComposerRequested={() => undefined}
          hydratedMessageIds={new Set<string>()}
          buildInlineArtifactUrl={(relativePath) => `https://example.test/${relativePath}`}
        />
      </MemoryRouter>
    );

    expect(html.match(/class="assistant-selection-content"/g)).toHaveLength(2);
    expect(html.match(/message-actions/g)).toHaveLength(1);
    expect(html).toContain("title=\"Copy\"");
    expect(html).toContain("title=\"Continue from here\"");
    expect(html).toContain("title=\"Retry from here\"");
    expect(html).toContain("title=\"Fork from here\"");
    expect(html).toContain("title=\"Start thread\"");
  });

  it("keeps historical tool group identity stable when new tools are appended", () => {
    const firstTool = createToolMessage({
      id: "tool-1",
      createdAt: "2026-03-10T00:00:01.000Z",
      command: "echo first"
    });
    const secondTool = createToolMessage({
      id: "tool-2",
      createdAt: "2026-03-10T00:00:02.000Z",
      command: "echo second"
    });

    expect(getHistoricalToolGroupKey([firstTool])).toBe("tool-group:tool-1");
    expect(getHistoricalToolGroupKey([firstTool, secondTool])).toBe("tool-group:tool-1");
  });

  it("keeps historical tool group identity stable when the visible window slides", () => {
    const firstTool = createToolMessage({
      id: "tool-1",
      createdAt: "2026-03-10T00:00:01.000Z",
      command: "echo first"
    });
    const secondTool = createToolMessage({
      id: "tool-2",
      createdAt: "2026-03-10T00:00:02.000Z",
      command: "echo second"
    });
    const thirdTool = createToolMessage({
      id: "tool-3",
      createdAt: "2026-03-10T00:00:03.000Z",
      command: "echo third"
    });

    const firstPass = buildStableHistoricalToolGroupDescriptors([firstTool, secondTool], [], 0);
    const secondPass = buildStableHistoricalToolGroupDescriptors(
      [secondTool, thirdTool],
      firstPass.descriptors,
      firstPass.nextCounter
    );

    expect(firstPass.descriptors).toHaveLength(1);
    expect(secondPass.descriptors).toHaveLength(1);
    expect(firstPass.descriptors[0]?.key).toBe("tool-group:tool-1");
    expect(secondPass.descriptors[0]?.key).toBe("tool-group:tool-1");
  });

  it("keeps historical tool group payloads collapsed until the group is opened", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          createToolMessage({
            id: "tool-1",
            createdAt: "2026-03-10T00:00:01.000Z",
            command: "echo first"
          }),
          createToolMessage({
            id: "tool-2",
            createdAt: "2026-03-10T00:00:02.000Z",
            command: "echo second"
          }),
          {
            id: "assistant-1",
            role: "assistant",
            content_json: { text: "Done" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:03.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
      />
    );

    expect(html).toContain("2 calls");
    expect(html).not.toContain("echo first");
    expect(html).not.toContain("echo second");
    expect(html).not.toContain("tool-group-content");
  });

  it("keeps the trailing tool group collapsed until it is opened manually", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content_json: { text: "Working on it" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          },
          createToolMessage({
            id: "tool-1",
            createdAt: "2026-03-10T00:00:01.000Z",
            command: "echo first"
          }),
          createToolMessage({
            id: "tool-2",
            createdAt: "2026-03-10T00:00:02.000Z",
            command: "echo second"
          })
        ]}
        hydratedMessageIds={new Set<string>(["tool-1", "tool-2"])}
      />
    );

    expect(html).toContain("2 calls");
    expect(html).not.toContain("echo first");
    expect(html).not.toContain("echo second");
    expect(html).not.toContain("tool-group-content");
    expect(html).not.toContain("tool-call-body");
  });

  it("renders inline HTML artifacts before the assistant message", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "assistant-inline-artifact",
            role: "assistant",
            content_json: {
              text: "Here is the visual summary.",
              response_items: [
                {
                  type: "custom_tool_call",
                  id: "ctc_inline_1",
                  call_id: "call_inline_1",
                  name: "html_canvas_inline_artifact",
                  input: "{\"output_path\":\"reports/summary.html\"}"
                },
                {
                  type: "custom_tool_call_output",
                  call_id: "call_inline_1",
                  output: JSON.stringify({
                    ok: true,
                    inline_artifact: {
                      type: "html",
                      relative_path: "reports/summary.html",
                      title: "Summary",
                      width: 760,
                      height: 540
                    }
                  })
                }
              ]
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:03.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
        buildInlineArtifactUrl={(relativePath) => `https://example.test/${relativePath}`}
      />
    );

    expect(html).toContain("Summary");
    expect(html).toContain("reports/summary.html");
    expect(html).toContain("inline-artifact-frame");
    expect(html).toContain("--inline-artifact-base-width:760px");
    expect(html).toContain("Here is the visual summary.");
    expect(html).not.toContain("1 calls");
    expect(html.indexOf("inline-artifact-frame")).toBeLessThan(html.indexOf("Here is the visual summary."));
  });

  it("does not duplicate inline artifacts already represented by ordered assistant response items", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "tool-inline-artifact",
            role: "tool",
            content_json: {
              tool: "html_canvas_inline_artifact",
              durationMs: 180,
              inline_artifact: {
                type: "html",
                relative_path: "reports/summary.html",
                title: "Summary",
                width: 760,
                height: 540
              }
            },
            parent_message_id: "assistant-inline-artifact",
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:02.000Z"
          },
          {
            id: "assistant-inline-artifact",
            role: "assistant",
            content_json: {
              text: "Here is the visual summary.",
              response_items: [
                {
                  type: "custom_tool_call",
                  id: "ctc_inline_1",
                  call_id: "call_inline_1",
                  name: "html_canvas_inline_artifact",
                  input: "{\"output_path\":\"reports/summary.html\"}"
                },
                {
                  type: "custom_tool_call_output",
                  call_id: "call_inline_1",
                  output: JSON.stringify({
                    ok: true,
                    inline_artifact: {
                      type: "html",
                      relative_path: "reports/summary.html",
                      title: "Summary",
                      width: 760,
                      height: 540
                    }
                  })
                },
                {
                  type: "function_call",
                  id: "fc_final_1",
                  call_id: "call_final_1",
                  name: "final_response",
                  arguments: JSON.stringify({ response: "Here is the visual summary.", partial: false }),
                  status: "completed"
                }
              ]
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:03.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
        buildInlineArtifactUrl={(relativePath) => `https://example.test/${relativePath}`}
      />
    );

    expect(html.match(/inline-artifact-frame/g)).toHaveLength(1);
    expect(html).toContain("reports/summary.html");
    expect(html).not.toContain("1 calls");
  });

  it("renders partial final responses and inline artifacts in response item order", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "assistant-inline-sequence",
            role: "assistant",
            content_json: {
              text: "Intro text.\n\nAfter text.",
              response_items: [
                {
                  type: "function_call",
                  id: "fc_partial_1",
                  call_id: "call_partial_1",
                  name: "final_response",
                  arguments: JSON.stringify({ response: "Intro text.", notify: true, partial: true }),
                  status: "completed"
                },
                {
                  type: "custom_tool_call",
                  id: "ctc_inline_1",
                  call_id: "call_inline_1",
                  name: "html_canvas_inline_artifact",
                  input: "{\"output_path\":\"reports/summary.html\"}"
                },
                {
                  type: "custom_tool_call_output",
                  call_id: "call_inline_1",
                  output: JSON.stringify({
                    ok: true,
                    inline_artifact: {
                      type: "html",
                      relative_path: "reports/summary.html",
                      title: "Summary"
                    }
                  })
                },
                {
                  type: "function_call",
                  id: "fc_final_1",
                  call_id: "call_final_1",
                  name: "final_response",
                  arguments: JSON.stringify({ response: "After text.", notify: true, partial: false }),
                  status: "completed"
                }
              ]
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:03.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
        buildInlineArtifactUrl={(relativePath) => `https://example.test/${relativePath}`}
      />
    );

    expect(html.indexOf("Intro text.")).toBeLessThan(html.indexOf("inline-artifact-frame"));
    expect(html.indexOf("inline-artifact-frame")).toBeLessThan(html.indexOf("After text."));
  });

  it("renders only the latest final_response group from persisted response items", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "assistant-duplicate-final",
            role: "assistant",
            content_json: {
              text: "The answer.",
              response_items: [
                {
                  type: "function_call",
                  id: "fc_final_1",
                  call_id: "call_final_1",
                  name: "final_response",
                  arguments: JSON.stringify({ response: "The answer.", notify: true, partial: false }),
                  status: "completed"
                },
                {
                  type: "function_call",
                  id: "fc_final_2",
                  call_id: "call_final_2",
                  name: "final_response",
                  arguments: JSON.stringify({ response: "The answer.", notify: true, partial: false }),
                  status: "completed"
                }
              ]
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:03.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
      />
    );

    expect(html.match(/The answer\./g)).toHaveLength(1);
  });

  it("deduplicates adjacent partial and final_response text segments", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "assistant-overlap-final",
            role: "assistant",
            content_json: {
              text: "Take a close look at how std::max is called.",
              response_items: [
                {
                  type: "function_call",
                  id: "fc_partial_1",
                  call_id: "call_partial_1",
                  name: "final_response",
                  arguments: JSON.stringify({
                    response: "Take a close look at how std::max is called.",
                    notify: true,
                    partial: true
                  }),
                  status: "completed"
                },
                {
                  type: "function_call",
                  id: "fc_final_1",
                  call_id: "call_final_1",
                  name: "final_response",
                  arguments: JSON.stringify({
                    response: "Take a close look at how std::max is called.",
                    notify: true,
                    partial: false
                  }),
                  status: "completed"
                }
              ]
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:03.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
      />
    );

    expect(html.match(/Take a close look at how std::max is called\./g)).toHaveLength(1);
  });

  it("renders inline HTML artifacts from persisted function tool messages", () => {
    const html = renderToStaticMarkup(
      <>
        {HistoricalConversationItems({
          messages: [
            {
              id: "tool-inline-artifact",
              role: "tool",
              content_json: {
                tool: "html_canvas_inline_artifact",
                response_function_call: {
                  call_id: "call_inline_fn_1",
                  name: "html_canvas_inline_artifact",
                  arguments: "{\"output_path\":\"reports/function-summary.html\"}"
                },
                response_function_output: {
                  call_id: "call_inline_fn_1",
                  output: JSON.stringify({
                    ok: true,
                    inline_artifact: {
                      type: "html",
                      relative_path: "reports/function-summary.html",
                      title: "Function summary",
                      width: 780,
                      height: 560
                    }
                  })
                }
              },
              parent_message_id: null,
              edited_from_message_id: null,
              created_at: "2026-03-10T00:00:02.000Z"
            },
            {
              id: "assistant-after-inline-artifact",
              role: "assistant",
              content_json: {
                text: "Function tool artifact rendered."
              },
              parent_message_id: null,
              edited_from_message_id: null,
              created_at: "2026-03-10T00:00:03.000Z"
            }
          ],
          showMessageActions: false,
          hydratedMessageIds: new Set<string>(["tool-inline-artifact"]),
          onToolGroupInspectorRequested: () => undefined,
          defaultAssistantMessageDisplayPreferences: {
            collapseLongMessages: true,
            renderMarkdown: true,
            renderCommonHtml: true,
            hideCitationMarkers: true,
            renderUserMessages: false,
            renderLatex: true,
            allowSingleDollarLatex: false,
            showThoughts: true,
            showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
          },
          resolvedAssistantMessageDisplayPreferences: {
            collapseLongMessages: true,
            renderMarkdown: true,
            renderCommonHtml: true,
            hideCitationMarkers: true,
            renderUserMessages: false,
            renderLatex: true,
            allowSingleDollarLatex: false,
            showThoughts: true,
            showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
          },
          historicalToolGroupDescriptorsByStartIndex: new Map(),
          buildInlineArtifactUrl: (relativePath) => `https://example.test/${relativePath}`
        })}
      </>
    );

    expect(html).toContain("Function summary");
    expect(html).toContain("reports/function-summary.html");
    expect(html).toContain("inline-artifact-frame");
    expect(html).toContain("--inline-artifact-base-width:780px");
    expect(html).toContain("Function tool artifact rendered.");
    expect(html).not.toContain("1 calls");
    expect(html.indexOf("inline-artifact-frame")).toBeLessThan(html.indexOf("Function tool artifact rendered."));
  });

  it("renders inline HTML artifacts from tool metadata without manual hydration", () => {
    const html = renderToStaticMarkup(
      <>
        {HistoricalConversationItems({
          messages: [
            {
              id: "tool-inline-artifact-metadata",
              role: "tool",
              content_json: {
                tool: "html_canvas_inline_artifact",
                durationMs: 180,
                inline_artifact: {
                  type: "html",
                  relative_path: "reports/metadata-summary.html",
                  title: "Metadata summary",
                  width: 720,
                  height: 560
                }
              },
              parent_message_id: null,
              edited_from_message_id: null,
              created_at: "2026-03-10T00:00:02.000Z"
            },
            {
              id: "assistant-after-inline-artifact-metadata",
              role: "assistant",
              content_json: {
                text: "Metadata-backed artifact rendered."
              },
              parent_message_id: null,
              edited_from_message_id: null,
              created_at: "2026-03-10T00:00:03.000Z"
            }
          ],
          showMessageActions: false,
          hydratedMessageIds: new Set<string>(),
          onToolGroupInspectorRequested: () => undefined,
          defaultAssistantMessageDisplayPreferences: {
            collapseLongMessages: true,
            renderMarkdown: true,
            renderCommonHtml: true,
            hideCitationMarkers: true,
            renderUserMessages: false,
            renderLatex: true,
            allowSingleDollarLatex: false,
            showThoughts: true,
            showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
          },
          resolvedAssistantMessageDisplayPreferences: {
            collapseLongMessages: true,
            renderMarkdown: true,
            renderCommonHtml: true,
            hideCitationMarkers: true,
            renderUserMessages: false,
            renderLatex: true,
            allowSingleDollarLatex: false,
            showThoughts: true,
            showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
          },
          historicalToolGroupDescriptorsByStartIndex: new Map(),
          buildInlineArtifactUrl: (relativePath) => `https://example.test/${relativePath}`
        })}
      </>
    );

    expect(html).toContain("Metadata summary");
    expect(html).toContain("inline-artifact-frame");
    expect(html).toContain("--inline-artifact-base-width:720px");
    expect(html).toContain("Canvas zoom");
    expect(html).toContain("type=\"range\"");
    expect(html).toContain("Metadata-backed artifact rendered.");
    expect(html).not.toContain("Activity");
    expect(html.indexOf("inline-artifact-frame")).toBeLessThan(html.indexOf("Metadata-backed artifact rendered."));
  });

  it("groups assistant thoughts inside the preceding worked-for tool section", () => {
    const messages: TaskMessage[] = [
      createToolMessage({
        id: "tool-1",
        createdAt: "2026-03-10T00:00:01.000Z",
        command: "echo first"
      }),
      {
        id: "assistant-1",
        role: "assistant",
        content_json: {
          text: "Done.",
          response_items: [
            {
              type: "reasoning",
              id: "rs_1",
              summary: [{ type: "summary_text", text: "Compared the requested change against the current code." }]
            }
          ]
        },
        parent_message_id: "tool-1",
        edited_from_message_id: null,
        created_at: "2026-03-10T00:00:02.000Z"
      }
    ];
    const html = renderToStaticMarkup(
      <>
        {HistoricalConversationItems({
          messages,
          showMessageActions: false,
          hydratedMessageIds: new Set<string>(["tool-1"]),
          onToolGroupInspectorRequested: () => undefined,
          defaultAssistantMessageDisplayPreferences: {
            collapseLongMessages: true,
            renderMarkdown: true,
            renderCommonHtml: true,
            hideCitationMarkers: true,
            renderUserMessages: false,
            renderLatex: true,
            allowSingleDollarLatex: false,
            showThoughts: true,
            showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
          },
          resolvedAssistantMessageDisplayPreferences: {
            collapseLongMessages: true,
            renderMarkdown: true,
            renderCommonHtml: true,
            hideCitationMarkers: true,
            renderUserMessages: false,
            renderLatex: true,
            allowSingleDollarLatex: false,
            showThoughts: true,
            showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
          },
          historicalToolGroupDescriptorsByStartIndex: new Map()
        })}
      </>
    );

    expect(html).toContain("Worked for 1.5s");
    expect(html).toContain("Thought for 1.0s");
    expect(html).not.toContain('class="chat-bubble thought-group"');
  });

  it("keeps swarm wait responses in the main chat instead of the tool summary header", () => {
    const toolMessage: TaskMessage = {
      id: "tool-swarm-wait",
      role: "tool",
      content_json: {
        tool: "swarm_pause",
        durationMs: 100,
        response_function_call: {
          name: "swarm_pause",
          call_id: "call_wait_1",
          arguments: JSON.stringify({
            seconds: 900,
            dependencies: [{ worker: "Leader", channel: "global" }],
            response: "Sleeping unless the leader asks for another pass.",
            notify: false
          })
        },
        response_function_output: {
          call_id: "call_wait_1",
          output: JSON.stringify({
            acknowledged: true,
            seconds: 900,
            next_run_at: "2026-03-10T00:15:00.000Z"
          })
        }
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T00:00:00.000Z"
    };
    const assistantMessage = createMessage({
      id: "assistant-swarm-wait",
      role: "assistant",
      createdAt: "2026-03-10T00:00:01.000Z",
      text: "Sleeping unless the leader asks for another pass."
    });
    const html = renderToStaticMarkup(
      <>
        {HistoricalConversationItems({
          messages: [toolMessage, assistantMessage],
          showMessageActions: false,
          hydratedMessageIds: new Set<string>([toolMessage.id]),
          onToolGroupInspectorRequested: () => undefined,
          defaultAssistantMessageDisplayPreferences: {
            collapseLongMessages: true,
            renderMarkdown: true,
            renderCommonHtml: true,
            hideCitationMarkers: true,
            renderUserMessages: false,
            renderLatex: true,
            allowSingleDollarLatex: false,
            showThoughts: true,
            showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
          },
          resolvedAssistantMessageDisplayPreferences: {
            collapseLongMessages: true,
            renderMarkdown: true,
            renderCommonHtml: true,
            hideCitationMarkers: true,
            renderUserMessages: false,
            renderLatex: true,
            allowSingleDollarLatex: false,
            showThoughts: true,
            showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
          },
          historicalToolGroupDescriptorsByStartIndex: new Map()
        })}
      </>
    );

    expect(html).toContain("Worked for 0.1s");
    expect(html).not.toContain("Worked for 0.1s · Sleeping unless the leader asks for another pass.");
    expect(html).toContain("Sleeping unless the leader asks for another pass.");
  });

  it("renders native compaction messages without requiring a human summary", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "compaction-1",
            role: "system",
            content_json: {
              kind: "context_compaction",
              text: "## Native Context Compaction\n\nStored an opaque compaction item.",
              compaction: {
                trigger: "auto",
                backend: "native"
              }
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
      />
    );

    expect(html).toContain("Context carried forward");
    expect(html).toContain("native");
    expect(html).toContain("View summary");
    expect(html).not.toContain("Stored an opaque compaction item");
  });

  it("renders context checkpoints as a modal action without exposing the description inline", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "checkpoint-1",
            role: "system",
            content_json: {
              kind: "context_checkpoint",
              action: "trim",
              checkpoint: "Private detailed continuity checkpoint.",
              trimmed_tool_count: 2
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
      />
    );

    expect(html).toContain("Context checkpoint saved");
    expect(html).toContain("2 oldest tool calls trimmed");
    expect(html).toContain("View checkpoint");
    expect(html).not.toContain("Private detailed continuity checkpoint.");
  });

  it("renders context window rollover checkpoint with response tool activity", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "checkpoint-rollover-1",
            role: "system",
            content_json: {
              kind: "context_checkpoint",
              action: "rollover",
              reason: "manual",
              checkpoint: "Context window rollover (manual). Conversation items archived to context history.",
              response_items: [
                {
                  type: "function_call",
                  id: "call_shell_1",
                  call_id: "call_shell_1",
                  name: "run_shell",
                  arguments: "{\"command\":\"echo test\"}"
                },
                {
                  type: "function_call_output",
                  call_id: "call_shell_1",
                  output: "test"
                }
              ]
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          },
          {
            id: "assistant-final-1",
            role: "assistant",
            content_json: {
              text: "All done."
            },
            parent_message_id: "checkpoint-rollover-1",
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:01.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
      />
    );

    expect(html).toContain("Context window rollover");
    expect(html).toContain("Rollover (manual)");
    expect(html).toContain("View checkpoint");
    expect(html).toContain("1 call");
    expect(html).toContain("All done.");
  });

  it("hides resolved retry notices once the conversation has recovered", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          createMessage({
            id: "retry-1",
            role: "system",
            text: "Model request failed (attempt 1/6): Something went wrong. Retrying in 3s...",
            createdAt: "2026-03-10T00:00:00.000Z"
          }),
          createMessage({
            id: "assistant-1",
            role: "assistant",
            text: "Recovered",
            createdAt: "2026-03-10T00:00:01.000Z"
          })
        ]}
      />
    );

    expect(html).not.toContain("Model retry");
    expect(html).not.toContain("retrying in 3s");
    expect(html).not.toContain("Something went wrong");
    expect(html).toContain("Recovered");
  });

  it("renders thought summaries from assistant response items", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "user-1",
            role: "user",
            content_json: { text: "Please fix it." },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          },
          {
            id: "assistant-1",
            role: "assistant",
            content_json: {
              text: "Done.",
              response_items: [
                {
                  type: "reasoning",
                  id: "rs_1",
                  summary: [{ type: "summary_text", text: "Compared the requested change against the current code." }]
                }
              ]
            },
            parent_message_id: "user-1",
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:04.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("Thought for 4.0s");
    expect(html).not.toContain("Compared the requested change against the current code.");
    expect(html).not.toContain("thought-group-content");
  });

  it("hides stored thought summaries and the live thinking bubble when thoughts are disabled", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        showThinking
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: false,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content_json: {
              text: "Done.",
              response_items: [
                {
                  type: "reasoning",
                  id: "rs_1",
                  summary: [{ type: "summary_text", text: "Hidden summary." }]
                }
              ]
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:01.000Z"
          }
        ]}
      />
    );

    expect(html).not.toContain("Hidden summary.");
    expect(html).not.toContain("Thought");
    expect(html).not.toContain("thinking-bubble");
  });


  it("renders user messages as plain text by default", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: false,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "user-1",
            role: "user",
            content_json: { text: "**User prompt**" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          },
          {
            id: "assistant-1",
            role: "assistant",
            content_json: { text: "**Assistant reply**" },
            parent_message_id: "user-1",
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:01.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("**User prompt**");
    expect(html).toContain("**Assistant reply**");
    expect(html).toContain("bubble-plain-text");
    expect(html).not.toContain("<pre");
  });

  it("can render user messages as markdown when enabled", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: false,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: true,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "user-1",
            role: "user",
            content_json: { text: "**User prompt**" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          },
          {
            id: "assistant-1",
            role: "assistant",
            content_json: { text: "**Assistant reply**" },
            parent_message_id: "user-1",
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:01.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("<strong>User prompt</strong>");
    expect(html).toContain("**Assistant reply**");
  });

  it("can disable LaTeX rendering while keeping markdown enabled for assistant messages", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: false,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content_json: { text: "Math: $x^2$" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("Math: $x^2$");
    expect(html).not.toContain("katex");
  });

  it("renders fenced code blocks with highlighting and code actions", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "assistant-code",
            role: "assistant",
            content_json: {
              text: "```cpp\nint main() {\n  return 0;\n}\n```"
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("markdown-code-block");
    expect(html).toContain("markdown-code-language");
    expect(html).toContain(">cpp<");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain(">int<");
    expect(html).toContain("title=\"Copy code\"");
    expect(html).toContain("title=\"Wrap text\"");
  });

  it("does not show a language label for plain text code fences", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "assistant-text-code",
            role: "assistant",
            content_json: {
              text: "```TEXT\nJust text.\n```"
            },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("markdown-code-block");
    expect(html).not.toContain("markdown-code-language");
    expect(html).not.toContain(">text<");
    expect(html).toContain("Just text.");
  });

  it("does not treat normal dollar amounts as LaTeX when models forget to escape dollars", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content_json: { text: "The plan costs $5 now and $10 next month." },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("The plan costs $5 now and $10 next month.");
    expect(html).not.toContain("katex");
  });

  it("keeps single-dollar LaTeX disabled by default", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content_json: { text: "Inline math: $x^2$" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("Inline math: $x^2$");
    expect(html).not.toContain("katex");
  });

  it("renders single-dollar LaTeX when the display preference is enabled", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: true,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content_json: { text: "Inline math: $x^2$" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("katex");
    expect(html).toContain("x");
  });

  it("still renders display LaTeX with double-dollar fences", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content_json: { text: "Display math:\n\n$$x^2 + y^2 = z^2$$" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("katex");
    expect(html).toContain("x");
    expect(html).toContain("y");
    expect(html).toContain("z");
  });

  it("collapses long user and assistant messages by default when enabled", () => {
    const longText = `${"Long message body. ".repeat(300)}\n${"Second paragraph. ".repeat(80)}`;
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          createMessage({
            id: "user-1",
            role: "user",
            createdAt: "2026-03-10T00:00:00.000Z",
            text: longText
          }),
          createMessage({
            id: "assistant-1",
            role: "assistant",
            createdAt: "2026-03-10T00:00:01.000Z",
            text: longText
          })
        ]}
      />
    );

    expect(html).toContain("bubble-collapsible-body collapsed");
    expect(html.match(/Read more/g)).toHaveLength(2);
  });

  it("does not auto-collapse long messages when the preference is disabled", () => {
    const longText = `${"Long message body. ".repeat(300)}\n${"Second paragraph. ".repeat(80)}`;
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        assistantMessageDisplayPreferences={{
          collapseLongMessages: false,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          showThoughts: true,
          showMessageSummaries: true,
            showScrollToBottomButton: true,
            showSelectionThreadActions: true,
            showSelectionThreadHighlights: true
        }}
        messages={[
          createMessage({
            id: "assistant-1",
            role: "assistant",
            createdAt: "2026-03-10T00:00:00.000Z",
            text: longText
          })
        ]}
      />
    );

    expect(html).not.toContain("bubble-collapsible-body collapsed");
    expect(html).not.toContain("Read more");
  });

  it("does not render duplicate tool activity bubbles from assistant response items", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          createToolMessage({
            id: "tool-1",
            createdAt: "2026-03-10T00:00:01.000Z",
            command: "ls -la",
            callId: "call_1"
          }),
          {
            id: "assistant-1",
            role: "assistant",
            content_json: {
              text: "Here is the list of files.",
              response_items: [
                {
                  type: "function_call",
                  id: "fc_1",
                  call_id: "call_1",
                  name: "run_shell",
                  arguments: JSON.stringify({ command: "ls -la" })
                },
                {
                  type: "function_call_output",
                  call_id: "call_1",
                  output: "total 0\n-rw-r--r-- 1 user user 0 Mar 10 00:00 file.txt"
                }
              ]
            },
            parent_message_id: "tool-1",
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:03.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>(["tool-1"])}
      />
    );

    expect(html.match(/Worked for 1\.5s/g)).toHaveLength(1);
    expect(html).not.toContain("Ran tool");
    expect(html).not.toContain("tool-group-cluster");
    expect(html).toContain("Here is the list of files.");
  });

  it("keeps response-item activity when a different call follows a standalone tool message", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          createToolMessage({
            id: "tool-1",
            createdAt: "2026-03-10T00:00:01.000Z",
            command: "ls -la",
            callId: "call_shell"
          }),
          {
            id: "assistant-1",
            role: "assistant",
            content_json: {
              text: "Patched.",
              response_items: [
                {
                  type: "custom_tool_call",
                  id: "fc_patch",
                  call_id: "call_patch",
                  name: "apply_patch",
                  input: "*** Begin Patch"
                },
                {
                  type: "custom_tool_call_output",
                  call_id: "call_patch",
                  output: "Updated file"
                }
              ]
            },
            parent_message_id: "tool-1",
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:03.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>(["tool-1"])}
      />
    );

    expect(html).toContain('data-message-ids="tool-1 assistant-1:response-tool:call_patch"');
    expect(html).toContain("2 calls");
    expect(html).toContain("Patched.");
  });

  it("renders web search activity bubbles from assistant response items when no standalone tool message exists", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          {
            id: "user-1",
            role: "user",
            content_json: { text: "Search the web" },
            parent_message_id: null,
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:00.000Z"
          },
          {
            id: "assistant-1",
            role: "assistant",
            content_json: {
              text: "Search complete.",
              response_items: [
                {
                  type: "web_search_call",
                  id: "ws_1",
                  status: "completed"
                }
              ]
            },
            parent_message_id: "user-1",
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:02.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>()}
      />
    );

    expect(html).toContain('data-message-ids="assistant-1:response-tool:ws_1"');
    expect(html).toContain("1 call");
    expect(html).toContain("Search complete.");
  });

  it("merges contiguous run_shell and apply_patch tool messages into a single activity bubble and deduplicates response items", () => {
    const html = renderToStaticMarkup(
      <TaskConversationMessages
        messages={[
          createToolMessage({
            id: "tool-1",
            createdAt: "2026-03-10T00:00:01.000Z",
            command: "ls -la",
            callId: "call_shell"
          }),
          createApplyPatchToolMessage({
            id: "tool-2",
            createdAt: "2026-03-10T00:00:02.000Z",
            callId: "call_patch"
          }),
          {
            id: "assistant-1",
            role: "assistant",
            content_json: {
              text: "Done.",
              response_items: [
                {
                  type: "function_call",
                  id: "fc_shell",
                  call_id: "call_shell",
                  name: "run_shell",
                  arguments: JSON.stringify({ command: "ls -la" })
                },
                {
                  type: "function_call_output",
                  call_id: "call_shell",
                  output: "total 0"
                },
                {
                  type: "custom_tool_call",
                  id: "fc_patch",
                  call_id: "call_patch",
                  name: "apply_patch",
                  input: "*** Begin Patch\n+hello\n*** End Patch"
                },
                {
                  type: "custom_tool_call_output",
                  call_id: "call_patch",
                  output: "Success"
                }
              ]
            },
            parent_message_id: "tool-2",
            edited_from_message_id: null,
            created_at: "2026-03-10T00:00:03.000Z"
          }
        ]}
        hydratedMessageIds={new Set<string>(["tool-1", "tool-2"])}
      />
    );

    expect(html.match(/Worked for/g)).toHaveLength(1);
    expect(html).toContain("2 calls");
    expect(html).toContain('data-message-ids="tool-1 tool-2"');
    expect(html).not.toContain("Ran tool");
    expect(html).not.toContain("tool-group-cluster");
  });
});
