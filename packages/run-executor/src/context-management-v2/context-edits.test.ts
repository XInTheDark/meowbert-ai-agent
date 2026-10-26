import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { applyContextEdits, buildContextEditItem, readContextEdit, validateContextEdit, type ContextEditRequest } from "./context-edits.js";

function call(callId: string, name = "run_shell"): ResponseInputItem {
  return { type: "function_call", call_id: callId, name, arguments: "{}" } as ResponseInputItem;
}

function output(callId: string, callNumber: number, text = "result"): ResponseInputItem {
  return { type: "function_call_output", call_id: callId, output: JSON.stringify({ call_number: callNumber, result: text }) } as ResponseInputItem;
}

const reasoning = (id: string): ResponseInputItem => ({ type: "reasoning", summary: [{ type: "summary_text", text: id }] } as unknown as ResponseInputItem);
const image: ResponseInputItem = { role: "user", content: [{ type: "input_image", detail: "high", image_url: "data:image/png;base64,AA" }] } as ResponseInputItem;
const userMessage: ResponseInputItem = { role: "user", content: "Also check the tests." };
const developerNote: ResponseInputItem = { role: "developer", content: "A skill was enabled." };

// Calls 1-2 explore in parallel, call 3 views an image, call 4 is the exec that requests the edit.
function conversation(): ResponseInputItem[] {
  return [
    { role: "user", content: "Fix the bug." },
    reasoning("r1"), call("a"), call("b"), output("a", 1, "big listing"), output("b", 2, "big file"),
    developerNote,
    reasoning("r3"), call("c", "view_image"), output("c", 3), image,
    reasoning("r4"), call("d", "exec"), output("d", 4)
  ];
}

const request = (overrides: Partial<ContextEditRequest> = {}): ContextEditRequest => ({
  fromCallNumber: 1,
  toCallNumber: 3,
  keepArguments: false,
  inputSummary: "Listed and read the parser.",
  outputSummary: "The bug is in parse.ts:42.",
  ...overrides
});

const validationOptions = { requestingCallId: "d", allowedRequestToolNames: new Set(["exec"]), pending: [] };

function applyRequested(items: ResponseInputItem[], edit: ContextEditRequest): ResponseInputItem[] {
  return applyContextEdits([...items, buildContextEditItem(items, edit, [4])]);
}

describe("context edits", () => {
  it("replaces the range and the requesting turn with one summary, keeping other items in place", () => {
    const edited = applyRequested(conversation(), request());

    expect(edited).toHaveLength(3);
    expect(edited[0]).toEqual({ role: "user", content: "Fix the bug." });
    expect(readContextEdit(edited[1])).toMatchObject({
      from_call_number: 1,
      to_call_number: 3,
      tools: { run_shell: 2, view_image: 1 },
      output_summary: "The bug is in parse.ts:42.",
      edited_by_call_numbers: [4]
    });
    expect(edited[2]).toBe(developerNote);
  });

  it("rebuilds the same window from history, which keeps the originals", () => {
    const history = [...conversation(), buildContextEditItem(conversation(), request(), [4])];
    const live = applyContextEdits(history);

    expect(applyContextEdits(history)).toEqual(live);
    expect(applyContextEdits(live)).toEqual(live);
  });

  it("keeps the calls and stubs their outputs when arguments are kept", () => {
    const edited = applyRequested(conversation(), request({ keepArguments: true }));

    expect(edited.filter((item) => (item as { type?: string }).type === "function_call").map((item) => (item as { call_id: string }).call_id))
      .toEqual(["a", "b", "c"]);
    expect(edited).not.toContain(image);
    expect(JSON.parse((edited[4] as { output: string }).output)).toEqual({ call_number: 1, replaced_by_context_edit: "1-3" });
    expect(readContextEdit(edited[edited.length - 1])).toMatchObject({ arguments_kept: true, input_summary: null });
    expect(applyContextEdits(edited)).toEqual(edited);
  });

  it("folds an earlier summary that falls inside a later range", () => {
    const first = applyRequested(conversation(), request({ toCallNumber: 2 }));
    const later = [...first, reasoning("r5"), call("e", "exec"), output("e", 5)];
    const merged = applyContextEdits([...later, buildContextEditItem(later, request({ toCallNumber: 3, outputSummary: "All of it." }), [5])]);

    expect(merged.map(readContextEdit).filter(Boolean)).toEqual([expect.objectContaining({ to_call_number: 3, output_summary: "All of it." })]);
  });

  it("rejects ranges that split a turn, cover the request, or span a user message", () => {
    expect(validateContextEdit(conversation(), request({ toCallNumber: 1 }), validationOptions)).toMatch(/made together/);
    expect(validateContextEdit(conversation(), request({ toCallNumber: 4 }), validationOptions)).toMatch(/end before the call/);
    expect(validateContextEdit(conversation(), request({ fromCallNumber: 9, toCallNumber: 9 }), validationOptions)).toMatch(/No call 9/);

    const withUser = conversation();
    withUser.splice(6, 0, userMessage);
    expect(validateContextEdit(withUser, request(), validationOptions)).toMatch(/user message/);
    expect(validateContextEdit(conversation(), request(), validationOptions)).toBeNull();
  });

  it("rejects a turn that also does other work, and overlapping edits", () => {
    expect(validateContextEdit(conversation(), request(), { ...validationOptions, allowedRequestToolNames: new Set(["context_replace_calls"]) }))
      .toMatch(/turn of their own/);
    expect(validateContextEdit(conversation(), request({ fromCallNumber: 3 }), { ...validationOptions, pending: [request({ toCallNumber: 3 })] }))
      .toMatch(/overlaps/);
  });
});
