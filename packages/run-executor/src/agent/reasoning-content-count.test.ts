import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { countPreservedReasoningContentItems } from "./reasoning-content-count.js";

describe("countPreservedReasoningContentItems", () => {
  it("counts OpenAI reasoning items with preserved encrypted content", () => {
    const items = [
      { type: "reasoning", encrypted_content: "encrypted-1", summary: [] },
      { type: "reasoning", encrypted_content: null, summary: [] },
      { type: "reasoning", encrypted_content: "encrypted-2", summary: [] },
      { type: "message", role: "assistant", content: "done" }
    ] as unknown as ResponseInputItem[];

    expect(countPreservedReasoningContentItems(items)).toBe(2);
  });

  it("counts Gemini thought signatures preserved on response items", () => {
    const items = [
      {
        type: "function_call",
        call_id: "call_1",
        name: "run_shell",
        arguments: "{}",
        extra_content: {
          google: {
            thought_signature: "gemini-thought-signature-1"
          }
        }
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "done",
            thoughtSignature: "gemini-thought-signature-2"
          }
        ]
      }
    ] as unknown as ResponseInputItem[];

    expect(countPreservedReasoningContentItems(items)).toBe(2);
  });

  it("returns zero when no opaque reasoning content was preserved", () => {
    const items = [
      { type: "reasoning", encrypted_content: null, summary: [] },
      { type: "message", role: "assistant", content: "done" }
    ] as unknown as ResponseInputItem[];

    expect(countPreservedReasoningContentItems(items)).toBe(0);
  });
});
