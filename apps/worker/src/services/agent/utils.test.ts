import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deepMergeJsonObjects,
  mapMessagesForResponsesInput,
  mergeTaskToolOptions,
  isNetworkRequestLoggingEnabled,
  normalizeEnvironmentJsonPayload,
  parseTaskMessageAgentSelection,
  pickRunAgentSelection,
  parseTaskMessageToolOptions,
  extractModelRequestPayload,
  toContinuityInputItem
} from "./utils.js";
import type { TaskMessageRow } from "./types.js";

function createPngBuffer(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

describe("normalizeEnvironmentJsonPayload", () => {
  it("nests default model request settings under responses when payload is missing", () => {
    const normalized = normalizeEnvironmentJsonPayload(null);

    expect(normalized).toEqual({
      responses: {
        reasoning: { effort: "high", summary: "detailed" },
        store: false
      }
    });
    expect("max_context_window_tokens" in normalized).toBe(false);
  });

  it("moves legacy top-level request keys into responses", () => {
    const normalized = normalizeEnvironmentJsonPayload({
      reasoning: { effort: "high" },
      store: true,
      max_context_window_tokens: 2048
    });

    expect(normalized).toEqual({
      responses: {
        reasoning: { effort: "high" },
        store: true
      }
    });
    expect("max_context_window_tokens" in normalized).toBe(false);
  });

  it("preserves provider-facing request values instead of coercing them as env settings", () => {
    const normalized = normalizeEnvironmentJsonPayload({
      store: "nope"
    });

    expect(normalized.responses).toEqual({
      store: "nope"
    });
  });

  it("normalizes sandbox networking overrides to canonical snake_case form", () => {
    const normalized = normalizeEnvironmentJsonPayload({
      store: false,
      sandbox: {
        networkEnabled: false
      }
    });

    expect(normalized).toEqual({
      responses: {
        store: false
      },
      sandbox: {
        network_enabled: false
      }
    });
  });

  it("preserves an explicit allow sandbox override", () => {
    const normalized = normalizeEnvironmentJsonPayload({
      sandbox: {
        networkEnabled: true
      }
    });

    expect(normalized).toEqual({
      sandbox: {
        network_enabled: true
      }
    });
  });
});

describe("isNetworkRequestLoggingEnabled", () => {
  it("reads snake_case and camelCase debug keys", () => {
    expect(
      isNetworkRequestLoggingEnabled({
        debug: {
          log_network_requests: true
        }
      })
    ).toBe(true);

    expect(
      isNetworkRequestLoggingEnabled({
        debug: {
          logNetworkRequests: true
        }
      })
    ).toBe(true);
  });

  it("returns false when flag is missing", () => {
    expect(isNetworkRequestLoggingEnabled({})).toBe(false);
  });
});

describe("parseTaskMessageToolOptions", () => {
  it("parses enabled task tools from user message payload", () => {
    const parsed = parseTaskMessageToolOptions({
      text: "run this",
      tools: {
        webSearch: true,
        memorySearch: true,
        scheduleTask: true,
        subtasks: true,
        computerUse: false,
        interactiveCanvas: false,
        enabledSkills: ["skill-a", "skill-b"],
        enabledSources: []
      }
    });

    expect(parsed).toEqual({
      webSearch: true,
      memorySearch: true,
      scheduleTask: true,
      subtasks: true,
      computerUse: false,
      interactiveCanvas: false,
      enabledSkills: ["skill-a", "skill-b"],
      enabledSources: []
    });
  });

  it("trims and deduplicates enabled source ids", () => {
    const parsed = parseTaskMessageToolOptions({
      text: "run this",
      tools: {
        enabledSkills: [" skill-a ", "skill-a", "", 123],
        enabledSources: [" google-drive ", "google-drive", "onedrive", null]
      }
    });

    expect(parsed.enabledSkills).toEqual(["skill-a"]);
    expect(parsed.enabledSources).toEqual(["google-drive", "onedrive"]);
  });

  it("falls back to disabled tools when payload is invalid", () => {
    const parsed = parseTaskMessageToolOptions({
      text: "hello",
      tools: "invalid"
    });

    expect(parsed).toEqual({
      webSearch: false,
      memorySearch: false,
      scheduleTask: false,
      subtasks: false,
      computerUse: false,
      interactiveCanvas: false,
      enabledSkills: [],
      enabledSources: []
    });
  });
});

describe("parseTaskMessageAgentSelection", () => {
  it("parses agent id from user payload", () => {
    const parsed = parseTaskMessageAgentSelection({
      text: "run this",
      agent: {
        id: "FAST"
      }
    });

    expect(parsed).toEqual({ id: "fast" });
  });

  it("returns null when payload is invalid", () => {
    const parsed = parseTaskMessageAgentSelection({
      text: "run this",
      agent: "fast"
    });

    expect(parsed).toBeNull();
  });
});

describe("pickRunAgentSelection", () => {
  it("returns the latest user agent selection from history", () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m1",
        role: "user",
        content_json: {
          text: "first",
          agent: { id: "default" }
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-03-01T00:00:00.000Z"
      },
      {
        id: "m2",
        role: "assistant",
        content_json: { text: "ok" },
        parent_message_id: "m1",
        edited_from_message_id: null,
        created_at: "2026-03-01T00:00:01.000Z"
      },
      {
        id: "m3",
        role: "user",
        content_json: {
          text: "second",
          agent: { id: "deep-think" }
        },
        parent_message_id: "m2",
        edited_from_message_id: null,
        created_at: "2026-03-01T00:00:02.000Z"
      }
    ];

    expect(pickRunAgentSelection(messages)).toEqual({ id: "deep-think" });
  });
});

describe("mergeTaskToolOptions", () => {
  it("preserves base options when override is absent", () => {
    const merged = mergeTaskToolOptions(
      {
        webSearch: true,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: ["base-skill"],
        enabledSources: []
      },
      null
    );

    expect(merged).toEqual({
      webSearch: true,
      memorySearch: false,
      scheduleTask: false,
      subtasks: false,
      computerUse: false,
      enabledSkills: ["base-skill"],
      enabledSources: []
    });
  });

  it("applies overrides and deduplicates skill ids", () => {
    const merged = mergeTaskToolOptions(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: ["base-skill"],
        enabledSources: []
      },
      {
        webSearch: true,
        memorySearch: true,
        scheduleTask: true,
        subtasks: true,
        computerUse: false,
        enabledSkills: ["skill-a", "skill-a", "skill-b"],
        enabledSources: []
      }
    );

    expect(merged).toEqual({
      webSearch: true,
      memorySearch: true,
      scheduleTask: true,
      subtasks: true,
      computerUse: false,
      enabledSkills: ["skill-a", "skill-b"],
      enabledSources: []
    });
  });

  it("deduplicates base and override enabled source ids", () => {
    const mergedWithoutOverride = mergeTaskToolOptions(
      {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: ["skill-a", "skill-a"],
        enabledSources: ["google-drive", "google-drive", "onedrive"]
      },
      null
    );

    expect(mergedWithoutOverride.enabledSkills).toEqual(["skill-a"]);
    expect(mergedWithoutOverride.enabledSources).toEqual(["google-drive", "onedrive"]);

    const mergedWithOverride = mergeTaskToolOptions(
      mergedWithoutOverride,
      {
        enabledSources: [" onedrive ", "google-drive", "onedrive", ""]
      }
    );

    expect(mergedWithOverride.enabledSources).toEqual(["onedrive", "google-drive"]);
  });
});

describe("deepMergeJsonObjects", () => {
  it("deep-merges nested objects and replaces arrays/scalars", () => {
    const merged = deepMergeJsonObjects(
      {
        model: "gpt-base",
        reasoning: {
          effort: "high",
          trace: { mode: "safe" }
        },
        tags: ["one"],
        store: false
      },
      {
        reasoning: {
          effort: "xhigh"
        },
        tags: ["two", "three"],
        store: true
      }
    );

    expect(merged).toEqual({
      model: "gpt-base",
      reasoning: {
        effort: "xhigh",
        trace: { mode: "safe" }
      },
      tags: ["two", "three"],
      store: true
    });
  });
});

describe("extractModelRequestPayload nested responses", () => {
  it("reads the explicit provider payload from responses", () => {
    const sanitized = extractModelRequestPayload({
      responses: {
        store: false,
        reasoning: { effort: "high" }
      },
      default_context: { system_prompt: "Use concise answers", personality: "friendly" },
      task_cleanup: { expiration_days: 30 },
      debug: { log_network_requests: true },
      sandbox: { network_enabled: false },
      memory: { enabled: true }
    });

    expect(sanitized).toEqual({
      store: false,
      reasoning: { effort: "high", summary: "detailed" }
    });
  });
});

describe("extractModelRequestPayload", () => {
  it("treats responses as the explicit provider boundary", () => {
    expect(
      extractModelRequestPayload({
        responses: {
          reasoning: { effort: "xhigh", summary: "detailed" },
          temperature: 0.2,
          custom_provider_flag: true
        },
        memory: { enabled: true }
      })
    ).toEqual({
      reasoning: { effort: "xhigh", summary: "detailed" },
      temperature: 0.2,
      custom_provider_flag: true
    });
  });

  it("returns an empty object when responses is missing", () => {
    expect(
      extractModelRequestPayload({
        reasoning: { effort: "xhigh" },
        memory: { enabled: true }
      })
    ).toEqual({});
  });
});

describe("mapMessagesForResponsesInput", () => {
  it("attributes messages sent by the Project Master without changing the user's own messages", async () => {
    const message = (id: string, contentJson: Record<string, unknown>): TaskMessageRow => ({
      id, role: "user", content_json: contentJson, parent_message_id: null, edited_from_message_id: null,
      created_at: "2026-09-28T00:00:00.000Z"
    });

    const [fromUser, fromMaster] = await mapMessagesForResponsesInput([
      message("m_user", { text: "Ship it." }),
      message("m_master", { text: "Also update the docs.", sender: "project_master" })
    ], "/tmp/task-inputs", "high") as Array<{ role: string; content: string }>;

    expect(fromUser).toEqual({ role: "user", content: "Ship it." });
    expect(fromMaster.content).toContain("Master");
    expect(fromMaster.content).toContain("Also update the docs.");
  });

  it("preserves opaque native compaction item ids when replaying a new turn", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m_compaction_1",
        role: "system",
        content_json: {
          kind: "context_compaction",
          response_items: [
            {
              type: "compaction",
              id: "cmp_123",
              encrypted_content: "opaque-compacted-context"
            }
          ]
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-08-31T00:00:00.000Z"
      }
    ];

    await expect(mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high")).resolves.toEqual([
      {
        type: "compaction",
        id: "cmp_123",
        encrypted_content: "opaque-compacted-context"
      }
    ]);
  });

  it("strips provider-managed item ids from persisted history before replay", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m_ids_1",
        role: "assistant",
        content_json: {
          text: "Old run output",
          response_items: [
            {
              id: "rs_123",
              type: "reasoning",
              summary: []
            },
            {
              id: "msg_123",
              type: "message",
              role: "assistant",
              content: "ok"
            }
          ]
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-02-28T00:00:00.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high");

    expect(mapped[0]).toEqual({
      type: "reasoning",
      summary: []
    });
    expect(mapped[1]).toEqual({
      type: "message",
      role: "assistant",
      content: "ok"
    });
    expect(typeof mapped[0] === "object" && mapped[0] !== null && !("id" in mapped[0])).toBe(true);
    expect(typeof mapped[1] === "object" && mapped[1] !== null && !("id" in mapped[1])).toBe(true);
  });

  it("replays persisted history exactly as the model saw it", async () => {
    const command = "python3 -c \"print('done')\"";
    const runItems = [
      { type: "function_call", call_id: "call_a", name: "run_shell", arguments: JSON.stringify({ command }) },
      { type: "function_call", call_id: "call_b", name: "run_shell", arguments: "{\"command\":\"ls\"}" },
      { type: "function_call_output", call_id: "call_a", output: JSON.stringify({ command, stdout: "done\n", context: "seen by model" }) },
      { type: "function_call_output", call_id: "call_b", output: "{\"stdout\":\"a.txt\\n\",\"context\":\"seen by model\"}" },
      { type: "message", role: "assistant", content: "All done" }
    ];
    const messages: TaskMessageRow[] = [
      {
        id: "m_tool_a",
        role: "tool",
        content_json: {
          tool: "run_shell",
          response_function_call: { call_id: "call_a", name: "run_shell", arguments: JSON.stringify({ command }) },
          response_function_output: { call_id: "call_a", output: "{\"stdout\":\"done\\n\"}" }
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-09-05T00:00:00.000Z"
      },
      {
        id: "m_run",
        role: "assistant",
        content_json: { text: "All done", response_items: runItems },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-09-05T00:00:01.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high");
    expect(mapped).toEqual(runItems);
  });

  it("restores a lost output from the tool message without reordering the run", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m_tool_lost",
        role: "tool",
        content_json: {
          tool: "run_shell",
          response_function_call: { call_id: "call_lost", name: "run_shell", arguments: "{}" },
          response_function_output: { call_id: "call_lost", output: "actual stored result" }
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-09-05T00:00:00.000Z"
      },
      {
        id: "m_interrupted_run",
        role: "assistant",
        content_json: {
          response_items: [
            { type: "function_call", call_id: "call_lost", name: "run_shell", arguments: "{}" },
            { type: "message", role: "assistant", content: "Interrupted" }
          ]
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-09-05T00:00:01.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high");
    expect(mapped).toEqual([
      { type: "function_call", call_id: "call_lost", name: "run_shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call_lost", output: "actual stored result" },
      { type: "message", role: "assistant", content: "Interrupted" }
    ]);
  });

  it("sanitizes legacy tool-message replay payloads", async () => {
    const mapped = await mapMessagesForResponsesInput([{
      id: "m_legacy_shell_1",
      role: "tool",
      content_json: {
        tool: "run_shell",
        command: "pwd",
        stdout: "/tmp\n"
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-09-05T00:00:00.000Z"
    }], "/tmp/task-inputs", "high");

    expect(mapped[0]).toEqual({
      role: "user",
      content: 'Shell tool result: {"tool":"run_shell","stdout":"/tmp\\n"}'
    });
  });

  it("does not replay final_response tool calls when an assistant text item is already persisted", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m1",
        role: "assistant",
        content_json: {
          text: "Old run output",
          response_items: [
            {
              type: "function_call",
              call_id: "call_orphan",
              name: "final_response",
              arguments: "{\"response\":\"ok\",\"notify\":false}"
            },
            {
              role: "assistant",
              content: "ok"
            }
          ]
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-02-28T00:00:00.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high");
    const callItems = mapped.filter((item) => typeof item === "object" && item !== null && "type" in item && item.type === "function_call");
    const outputItems = mapped.filter(
      (item) => typeof item === "object" && item !== null && "type" in item && item.type === "function_call_output"
    );

    expect(mapped).toEqual([{
      role: "assistant",
      content: "ok"
    }]);
    expect(callItems).toHaveLength(0);
    expect(outputItems).toHaveLength(0);
  });

  it("replays assistant text once for final_response-only persisted history", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m1",
        role: "assistant",
        content_json: {
          text: "Final answer",
          response_items: [
            {
              type: "function_call",
              call_id: "call_final",
              name: "final_response",
              arguments: "{\"response\":\"Final answer\",\"notify\":false}"
            },
            {
              type: "function_call_output",
              call_id: "call_final",
              output: "{\"acknowledged\":true}"
            }
          ]
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-02-28T00:00:00.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high");

    expect(mapped).toEqual([{
      role: "assistant",
      content: "Final answer"
    }]);
  });

  it("normalizes legacy and current task input references to absolute paths", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m1",
        role: "user",
        content_json: {
          text: "Use ../inputs/legacy.txt and inputs/current.txt"
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-02-28T00:00:00.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task/inputs", "high");
    expect(mapped[0]).toEqual({
      role: "user",
      content: "Use /tmp/task/inputs/legacy.txt and /tmp/task/inputs/current.txt"
    });
  });

  it("sends message metadata as a system message when enabled", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m1",
        role: "user",
        content_json: {
          text: "Use ../inputs/legacy.txt"
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-02-28T00:00:00.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(
      messages,
      "/tmp/task/inputs",
      "high",
      { sendMetadataToModel: true }
    );

    expect(mapped).toEqual([
      {
        role: "user",
        content: "Use /tmp/task/inputs/legacy.txt"
      },
      {
        role: "system",
        content: "{\"metadata\":{\"message_time\":\"2026-02-28T00:00:00.000Z\"}}"
      }
    ]);
  });

  it("keeps tool results free of message metadata in model input", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m1",
        role: "tool",
        content_json: {
          command: "npm test",
          exitCode: 0
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-02-28T00:00:03.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high");
    expect(mapped[0]).toEqual({
      role: "user",
      content: "Shell tool result: {\"command\":\"npm test\",\"exitCode\":0}"
    });
  });

  it("fully includes forced text file attachments after the user message", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "meowbert-force-include-"));
    try {
      writeFileSync(path.join(tempDir, "notes.txt"), "full attachment text", "utf8");
      const messages: TaskMessageRow[] = [
        {
          id: "m1",
          role: "user",
          content_json: {
            text: "Review this",
            attachments: [
              {
                kind: "file",
                label: "notes.txt",
                content: "inputs/notes.txt",
                relativePath: "inputs/notes.txt",
                forceInclude: true
              }
            ]
          },
          parent_message_id: null,
          edited_from_message_id: null,
          created_at: "2026-02-28T00:00:00.000Z"
        }
      ];

      const mapped = await mapMessagesForResponsesInput(messages, tempDir, "high");

      expect(mapped).toHaveLength(2);
      expect(mapped[1]).toEqual({
        role: "user",
        content: "Force-included file (notes.txt, inputs/notes.txt):\nfull attachment text"
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("labels forced image attachments before injecting image bytes", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "meowbert-force-image-"));
    try {
      writeFileSync(path.join(tempDir, "image.png"), createPngBuffer(8, 6));
      const messages: TaskMessageRow[] = [
        {
          id: "m1",
          role: "user",
          content_json: {
            text: "Review this",
            attachments: [
              {
                kind: "file",
                label: "image.png",
                content: "inputs/image.png",
                relativePath: "inputs/image.png",
                forceInclude: true
              }
            ]
          },
          parent_message_id: null,
          edited_from_message_id: null,
          created_at: "2026-02-28T00:00:00.000Z"
        }
      ];

      const mapped = await mapMessagesForResponsesInput(messages, tempDir, "high");

      expect(mapped).toHaveLength(2);
      expect(mapped[1]).toEqual({
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Force-included image file: image.png"
          },
          expect.objectContaining({
            type: "input_image",
            image_url: expect.stringContaining("data:image/png;base64,")
          })
        ]
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not include attachment bytes unless force include is enabled", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "meowbert-regular-attachment-"));
    try {
      writeFileSync(path.join(tempDir, "notes.txt"), "not included", "utf8");
      const messages: TaskMessageRow[] = [
        {
          id: "m1",
          role: "user",
          content_json: {
            text: "Review this",
            attachments: [
              {
                kind: "file",
                label: "notes.txt",
                content: "inputs/notes.txt",
                relativePath: "inputs/notes.txt"
              }
            ]
          },
          parent_message_id: null,
          edited_from_message_id: null,
          created_at: "2026-02-28T00:00:00.000Z"
        }
      ];

      const mapped = await mapMessagesForResponsesInput(messages, tempDir, "high");

      expect(mapped).toHaveLength(1);
      expect(JSON.stringify(mapped)).not.toContain("not included");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("mapMessagesForResponsesInput custom tool history", () => {
  it("repairs missing custom_tool_call_output pairs from persisted history", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m_custom_patch_1",
        role: "assistant",
        content_json: {
          text: "Patched files",
          response_items: [
            {
              type: "custom_tool_call",
              call_id: "call_custom_patch_orphan",
              name: "apply_patch",
              input: "*** Begin Patch\n*** End Patch"
            }
          ]
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-02-28T00:04:00.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high");
    const customOutputs = mapped.filter(
      (item) => typeof item === "object" && item !== null && "type" in item && (item as { type?: string }).type === "custom_tool_call_output"
    );

    expect(customOutputs).toEqual([
      {
        type: "custom_tool_call_output",
        call_id: "call_custom_patch_orphan",
        output: "Recovered missing custom_tool_call_output from historical task state."
      }
    ]);
  });
});

describe("mapMessagesForResponsesInput apply_patch history", () => {
  it("repairs missing apply_patch_call_output pairs from persisted history", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m_patch_1",
        role: "assistant",
        content_json: {
          text: "Patched files",
          response_items: [
            {
              type: "apply_patch_call",
              call_id: "call_patch_orphan",
              status: "completed",
              operation: {
                type: "update_file",
                path: "src/index.ts",
                diff: "@@\n-old\n+new"
              }
            }
          ]
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-02-28T00:05:00.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high");
    const applyPatchOutputs = mapped.filter(
      (item) => typeof item === "object" && item !== null && "type" in item && (item as { type?: string }).type === "apply_patch_call_output"
    );

    expect(applyPatchOutputs).toHaveLength(1);
    expect(applyPatchOutputs[0]).toEqual({
      type: "apply_patch_call_output",
      call_id: "call_patch_orphan",
      status: "failed",
      output: "Recovered missing apply_patch_call_output from historical task state."
    });
  });

  it("reconstructs standalone tool-message call/output pairs", async () => {
    const messages: TaskMessageRow[] = [
      {
        id: "m_tool_patch",
        role: "tool",
        content_json: {
          tool: "apply_patch",
          callId: "call_patch_1",
          response_apply_patch_call: {
            type: "apply_patch_call",
            call_id: "call_patch_1"
          },
          response_apply_patch_output: {
            type: "apply_patch_call_output",
            call_id: "call_patch_1",
            status: "completed",
            output: "Updated"
          }
        },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-02-28T00:04:00.000Z"
      }
    ];

    const mapped = await mapMessagesForResponsesInput(messages, "/tmp/task-inputs", "high");
    expect(mapped).toEqual([
      {
        type: "apply_patch_call",
        call_id: "call_patch_1"
      },
      {
        type: "apply_patch_call_output",
        call_id: "call_patch_1",
        status: "completed",
        output: "Updated"
      }
    ]);
  });
});

describe("toContinuityInputItem", () => {
  it("strips provider-managed ids from output-derived continuity items", () => {
    const reasoningItem = toContinuityInputItem({
      id: "rs_123",
      type: "reasoning",
      summary: [],
      encrypted_content: "encrypted"
    });
    const functionCallItem = toContinuityInputItem({
      id: "fc_123",
      type: "function_call",
      call_id: "call_123",
      name: "run_shell",
      arguments: "{}"
    });

    expect(reasoningItem).toEqual({
      type: "reasoning",
      summary: [],
      encrypted_content: "encrypted"
    });
    expect(functionCallItem).toEqual({
      type: "function_call",
      call_id: "call_123",
      name: "run_shell",
      arguments: "{}"
    });
    expect(typeof reasoningItem === "object" && reasoningItem !== null && !("id" in reasoningItem)).toBe(true);
    expect(typeof functionCallItem === "object" && functionCallItem !== null && !("id" in functionCallItem)).toBe(true);
  });
});
