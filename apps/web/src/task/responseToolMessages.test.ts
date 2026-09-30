import { describe, expect, it } from "vitest";
import { getResponseToolMessages } from "./responseToolMessages";
import type { TaskMessage } from "../lib/types";

describe("getResponseToolMessages", () => {
  it("extracts native web search calls from assistant response items", () => {
    const message: TaskMessage = {
      id: "msg_assistant_1",
      role: "assistant",
      content_json: {
        text: "Done.",
        response_items: [
          { type: "reasoning", id: "rs_1", summary: [] },
          { type: "web_search_call", id: "ws_1", status: "completed" },
          { type: "message", id: "out_1", role: "assistant", content: [] }
        ]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:00.000Z"
    };

    expect(getResponseToolMessages(message)).toEqual([
      {
        id: "msg_assistant_1:response-tool:ws_1",
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
        parent_message_id: "msg_assistant_1",
        edited_from_message_id: null,
        created_at: "2026-03-10T06:00:00.000Z"
      }
    ]);
  });

  it("extracts custom apply_patch calls and pairs them with their outputs", () => {
    const message: TaskMessage = {
      id: "msg_assistant_custom_patch",
      role: "assistant",
      content_json: {
        text: "Patched.",
        response_items: [
          {
            type: "custom_tool_call",
            id: "ctc_1",
            call_id: "call_patch_custom_1",
            name: "apply_patch",
            input: "*** Begin Patch\n*** Update File: src/index.ts\n@@\n-console.log(\"old\")\n+console.log(\"new\")\n*** End Patch"
          },
          {
            type: "custom_tool_call_output",
            call_id: "call_patch_custom_1",
            output: "Updated src/index.ts"
          }
        ]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:30.000Z"
    };

    expect(getResponseToolMessages(message)).toEqual([
      {
        id: "msg_assistant_custom_patch:response-tool:call_patch_custom_1",
        role: "tool",
        content_json: {
          tool: "apply_patch",
          callId: "call_patch_custom_1",
          response_custom_tool_call: {
            type: "custom_tool_call",
            id: "ctc_1",
            call_id: "call_patch_custom_1",
            name: "apply_patch",
            input: "*** Begin Patch\n*** Update File: src/index.ts\n@@\n-console.log(\"old\")\n+console.log(\"new\")\n*** End Patch"
          },
          response_custom_tool_output: {
            type: "custom_tool_call_output",
            call_id: "call_patch_custom_1",
            output: "Updated src/index.ts"
          }
        },
        parent_message_id: "msg_assistant_custom_patch",
        edited_from_message_id: null,
        created_at: "2026-03-10T06:00:30.000Z"
      }
    ]);
  });

  it("extracts inline HTML artifact payloads from custom tool output", () => {
    const message: TaskMessage = {
      id: "msg_assistant_inline_artifact",
      role: "assistant",
      content_json: {
        text: "Generated a report.",
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
                title: "Summary report",
                description: "Rendered inline.",
                width: 760,
                height: 620
              }
            })
          }
        ]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:45.000Z"
    };

    expect(getResponseToolMessages(message)).toEqual([
      {
        id: "msg_assistant_inline_artifact:response-tool:call_inline_1",
        role: "tool",
        content_json: {
          tool: "html_canvas_inline_artifact",
          callId: "call_inline_1",
          response_custom_tool_call: {
            type: "custom_tool_call",
            id: "ctc_inline_1",
            call_id: "call_inline_1",
            name: "html_canvas_inline_artifact",
            input: "{\"output_path\":\"reports/summary.html\"}"
          },
          response_custom_tool_output: {
            type: "custom_tool_call_output",
            call_id: "call_inline_1",
            output: JSON.stringify({
              ok: true,
              inline_artifact: {
                type: "html",
                relative_path: "reports/summary.html",
                title: "Summary report",
                description: "Rendered inline.",
                width: 760,
                height: 620
              }
            })
          },
          inline_artifact: {
            type: "html",
            relativePath: "reports/summary.html",
            title: "Summary report",
            description: "Rendered inline.",
            width: 760,
            height: 620
          }
        },
        parent_message_id: "msg_assistant_inline_artifact",
        edited_from_message_id: null,
        created_at: "2026-03-10T06:00:45.000Z"
      }
    ]);
  });

  it("extracts ordinary function calls instead of omitting non-artifact tools", () => {
    const message: TaskMessage = {
      id: "msg_assistant_function_patch",
      role: "assistant",
      content_json: {
        response_items: [
          {
            type: "function_call",
            id: "fc_patch_1",
            call_id: "call_patch_function_1",
            name: "apply_patch",
            arguments: "{\"patch\":\"*** Begin Patch\"}"
          },
          {
            type: "function_call_output",
            call_id: "call_patch_function_1",
            output: "Updated src/index.ts"
          },
          {
            type: "function_call",
            call_id: "call_final_1",
            name: "final_response",
            arguments: "{\"response\":\"Done.\"}"
          }
        ]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:50.000Z"
    };

    expect(getResponseToolMessages(message)).toEqual([
      expect.objectContaining({
        role: "tool",
        content_json: expect.objectContaining({
          tool: "apply_patch",
          callId: "call_patch_function_1",
          response_function_output: expect.objectContaining({ output: "Updated src/index.ts" })
        })
      })
    ]);
  });

  it("extracts apply_patch calls and pairs them with their outputs", () => {
    const message: TaskMessage = {
      id: "msg_assistant_2",
      role: "assistant",
      content_json: {
        text: "Patched.",
        response_items: [
          {
            type: "apply_patch_call",
            id: "apc_1",
            call_id: "call_patch_1",
            status: "completed",
            operation: {
              type: "update_file",
              path: "src/index.ts",
              diff: "@@\n-console.log(\"old\")\n+console.log(\"new\")"
            }
          },
          {
            type: "apply_patch_call_output",
            call_id: "call_patch_1",
            status: "completed",
            output: "Updated src/index.ts"
          }
        ]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:01:00.000Z"
    };

    expect(getResponseToolMessages(message)).toEqual([
      {
        id: "msg_assistant_2:response-tool:call_patch_1",
        role: "tool",
        content_json: {
          tool: "apply_patch",
          callId: "call_patch_1",
          response_apply_patch_call: {
            type: "apply_patch_call",
            id: "apc_1",
            call_id: "call_patch_1",
            status: "completed",
            operation: {
              type: "update_file",
              path: "src/index.ts",
              diff: "@@\n-console.log(\"old\")\n+console.log(\"new\")"
            }
          },
          response_apply_patch_output: {
            type: "apply_patch_call_output",
            call_id: "call_patch_1",
            status: "completed",
            output: "Updated src/index.ts"
          }
        },
        parent_message_id: "msg_assistant_2",
        edited_from_message_id: null,
        created_at: "2026-03-10T06:01:00.000Z"
      }
    ]);
  });

  it("ignores non-assistant messages and unsupported response items", () => {
    const userMessage: TaskMessage = {
      id: "msg_user_1",
      role: "user",
      content_json: {
        response_items: [{ type: "web_search_call", id: "ws_ignored", status: "completed" }]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:00.000Z"
    };

    expect(getResponseToolMessages(userMessage)).toEqual([]);
  });

  it("extracts response tools from system context checkpoint messages", () => {
    const checkpointMessage: TaskMessage = {
      id: "msg_system_checkpoint_1",
      role: "system",
      content_json: {
        kind: "context_checkpoint",
        action: "rollover",
        checkpoint: "Context window rollover (manual).",
        response_items: [
          {
            type: "function_call",
            id: "call_shell_1",
            call_id: "call_shell_1",
            name: "run_shell",
            arguments: "{\"command\":\"ls\"}"
          },
          {
            type: "function_call_output",
            call_id: "call_shell_1",
            output: "file1.txt\nfile2.txt"
          }
        ]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:00.000Z"
    };

    expect(getResponseToolMessages(checkpointMessage)).toEqual([
      {
        id: "msg_system_checkpoint_1:response-tool:call_shell_1",
        role: "tool",
        content_json: {
          tool: "run_shell",
          callId: "call_shell_1",
          response_function_call: {
            type: "function_call",
            id: "call_shell_1",
            call_id: "call_shell_1",
            name: "run_shell",
            arguments: "{\"command\":\"ls\"}"
          },
          response_function_output: {
            type: "function_call_output",
            call_id: "call_shell_1",
            output: "file1.txt\nfile2.txt"
          }
        },
        parent_message_id: "msg_system_checkpoint_1",
        edited_from_message_id: null,
        created_at: "2026-03-10T06:00:00.000Z"
      }
    ]);
  });

  it("does not replay response tools from context compaction messages", () => {
    const compactionMessage: TaskMessage = {
      id: "msg_system_compaction_1",
      role: "system",
      content_json: {
        kind: "context_compaction",
        response_items: [
          {
            type: "web_search_call",
            id: "search_1",
            status: "completed"
          }
        ]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:00.000Z"
    };

    expect(getResponseToolMessages(compactionMessage)).toEqual([]);
  });
});
