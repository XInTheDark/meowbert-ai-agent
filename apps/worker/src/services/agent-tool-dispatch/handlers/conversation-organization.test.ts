import { describe, expect, it } from "vitest";
import { handleConversationOrganization, validateOrganizationFinalResponse } from "./conversation-organization.js";
import type { ToolDispatchState } from "../types.js";

function state(): ToolDispatchState {
  return { conversationItems: [], runPersistedItems: [], commandStep: 0, organization: {
    navigation: { enabled: true, active_leaf_message_id: null, outline: null, map: null, turns: [], messages: [] },
    publicMessageIds: [], outline: null, graph: null, outlineChanged: false, mapChanged: false
  } };
}
const call = (name: string, args: unknown) => ({ type: "function_call" as const, call_id: "call-1", name, arguments: JSON.stringify(args) });

describe("organization completion boundary", () => {
  it("requires a summary only when enabled and concluding", () => {
    expect(() => validateOrganizationFinalResponse({}, { ...state(), organization: undefined })).not.toThrow();
    expect(() => validateOrganizationFinalResponse({ partial: true }, state())).not.toThrow();
    expect(() => validateOrganizationFinalResponse({ outline_review: "not_applicable" }, state())).toThrow();
    expect(() => validateOrganizationFinalResponse({ summary: "Explain induction", outline_review: "not_applicable" }, state())).not.toThrow();
  });

  it("requires review of an active outline without manufacturing another revision", () => {
    const value = state();
    value.organization!.outline = "## Key points\nInduction";
    value.organization!.navigation.outline = { markdown: value.organization!.outline, message_id: "old" };
    expect(() => validateOrganizationFinalResponse({ summary: "Continue lesson", outline_review: "not_applicable" }, value)).toThrow("unchanged");
    expect(() => validateOrganizationFinalResponse({ summary: "Continue lesson", outline_review: "unchanged" }, value)).not.toThrow();
    handleConversationOrganization(call("update_conversation_outline", { markdown: value.organization!.outline }), value);
    expect(value.organization!.outlineChanged).toBe(false);
  });

  it("stages complete effective graph state and requires current turn placement", () => {
    const value = state(); value.organization!.graph = { nodes: [], topics: [], main_path_end_id: null };
    expect(() => validateOrganizationFinalResponse({ summary: "Begin lesson", outline_review: "not_applicable" }, value)).toThrow("main-path endpoint");
    handleConversationOrganization(call("update_conversation_map", {
      nodes: [{ id: "current", parent_id: null, topic_id: "lesson" }], topics: [{ id: "lesson", label: "Induction" }], main_path_end_id: "current"
    }), value);
    expect(value.organization!.graph!.nodes).toHaveLength(1);
    expect(value.organization!.mapChanged).toBe(true);
    expect(() => validateOrganizationFinalResponse({ summary: "Begin lesson", outline_review: "not_applicable" }, value)).not.toThrow();
  });

  it("rejects writes when disabled and links outside the public conversation", () => {
    expect(() => handleConversationOrganization(call("update_conversation_outline", { markdown: "Hello" }), { ...state(), organization: undefined })).toThrow("disabled");
    expect(() => handleConversationOrganization(call("update_conversation_outline", { markdown: "[private](#message-10000000-0000-4000-8000-000000000001)" }), state())).toThrow("not in this conversation");
  });
});
