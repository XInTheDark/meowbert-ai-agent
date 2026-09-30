import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../../lib/types";
import { ToolOutput } from "./ToolOutput";

describe("ToolOutput", () => {
  it("renders synthetic web search tool cards without a step chip", () => {
    const message: TaskMessage = {
      id: "msg_tool_web_1",
      role: "tool",
      content_json: {
        tool: "web_search",
        callId: "ws_1",
        response_web_search_call: {
          type: "web_search_call",
          id: "ws_1",
          status: "completed"
        }
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:00.000Z"
    };

    const html = renderToStaticMarkup(<ToolOutput message={message} />);

    expect(html).toContain("web search");
    expect(html).toContain("Completed");
    expect(html).not.toContain("call ws_1");
    expect(html).not.toContain("step 0");
  });

  it("uses a subdued context-management treatment for context tools", () => {
    const message: TaskMessage = {
      id: "tool-1",
      role: "tool",
      content_json: {
        tool: "notes_write_file",
        response_function_call: {
          type: "function_call",
          call_id: "call-1",
          name: "notes_write_file",
          arguments: JSON.stringify({ path: "notes/continuity.md", text: "Saved progress." })
        },
        response_function_output: {
          type: "function_call_output",
          call_id: "call-1",
          output: JSON.stringify({ path: "notes/continuity.md", updated: true })
        }
      },
      parent_message_id: "assistant-1",
      edited_from_message_id: null,
      created_at: "2026-09-04T00:00:00.000Z"
    };

    const html = renderToStaticMarkup(<ToolOutput message={message} />);

    expect(html).toContain("tool-call-card context-management");
    expect(html).toContain("notes write file");
  });

  it("does not render a legacy shell command again inside the result section", () => {
    const command = "python3 -c \"print('done')\"";
    const message: TaskMessage = {
      id: "tool-shell-legacy",
      role: "tool",
      content_json: {
        tool: "run_shell",
        response_function_call: {
          type: "function_call",
          call_id: "call-shell-legacy",
          name: "run_shell",
          arguments: JSON.stringify({ command })
        },
        response_function_output: {
          type: "function_call_output",
          call_id: "call-shell-legacy",
          output: JSON.stringify({ command, stdout: "done\n", stderr: "", exitCode: 0 })
        }
      },
      parent_message_id: "assistant-shell-legacy",
      edited_from_message_id: null,
      created_at: "2026-09-05T00:00:00.000Z"
    };

    const html = renderToStaticMarkup(<ToolOutput message={message} defaultOpen />);

    expect(html.match(/python3/g)).toHaveLength(1);
    expect(html).not.toContain('<span class="tool-section-label">Result</span>');
  });

  it("strips ANSI color escape codes when rendering stdout and stderr", () => {
    const message: TaskMessage = {
      id: "tool-shell-ansi",
      role: "tool",
      content_json: {
        tool: "run_shell",
        command: "rg overlap",
        stdout: "\x1b[0m\x1b[35m/path/to/file.py\x1b[0m\n\x1b[0m\x1b[32m21\x1b[0m:    warn_about_\x1b[0m\x1b[1m\x1b[31moverlap\x1b[0ms,\n",
        stderr: "",
        exitCode: 0
      },
      parent_message_id: "assistant-1",
      edited_from_message_id: null,
      created_at: "2026-09-06T00:00:00.000Z"
    };

    const html = renderToStaticMarkup(<ToolOutput message={message} defaultOpen />);

    expect(html).toContain("/path/to/file.py");
    expect(html).toContain("21:    warn_about_overlaps,");
    expect(html).not.toContain("[0m");
    expect(html).not.toContain("[35m");
    expect(html).not.toContain("[32m");
    expect(html).not.toContain("[31m");
  });

  it("preserves terminal-looking text in command sections", () => {
    const message: TaskMessage = {
      id: "tool-shell-command-text",
      role: "tool",
      content_json: {
        tool: "run_shell",
        command: "grep [0m file",
        stdout: "",
        stderr: "",
        exitCode: 0
      },
      parent_message_id: "assistant-1",
      edited_from_message_id: null,
      created_at: "2026-09-06T00:00:00.000Z"
    };

    const html = renderToStaticMarkup(<ToolOutput message={message} defaultOpen />);

    expect(html).toContain("grep [0m file");
  });
});
