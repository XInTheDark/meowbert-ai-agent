import { describe, expect, it } from "vitest";
import { buildConversationTurns, remapConversationMap, remapConversationOutline, turnSummarySchema, validateConversationMap } from "./conversation-organization.js";
import { getNewMessageOrganizationEnabled, DEFAULT_NEW_MESSAGE_ORGANIZATION_ENABLED } from "./workspace-agent-settings.js";

const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const c = "10000000-0000-4000-8000-000000000003";

describe("conversation organization", () => {
  it("inherits one shared default and preserves explicit workspace overrides", () => {
    expect(getNewMessageOrganizationEnabled({})).toBe(DEFAULT_NEW_MESSAGE_ORGANIZATION_ENABLED);
    expect(getNewMessageOrganizationEnabled({ newMessageOrganizationEnabled: false })).toBe(false);
    expect(getNewMessageOrganizationEnabled({ newMessageOrganizationEnabled: true })).toBe(true);
  });

  it("groups consecutive user inputs and skips internal and empty messages", () => {
    const message = (id: string, role: string, text: string, summary: string | null = null) => ({ id, role, text, summary, created_at: "2026-09-15", parent_message_id: null });
    const turns = buildConversationTurns([message("u1", "user", "Explain induction"), message("tool", "tool", "result"),
      message("u2", "user", "Use an example"), message("checkpoint", "system", "rollover"), message("empty", "assistant", ""),
      message(a, "assistant", "The answer", "Explain induction with an example"), message("u3", "user", "Next question")]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ id: a, message_ids: ["u1", "u2", a], user_message_id: "u1", has_summary: true, completed: true });
    expect(turns[1]).toMatchObject({ id: "u3", completed: false, summary: "Next question" });
  });

  it("accepts a return to an earlier turn and rejects cycles or unrelated references", () => {
    const graph = { nodes: [{ id: a, parent_id: null, topic_id: null }, { id: b, parent_id: a, topic_id: null },
      { id: c, parent_id: a, topic_id: null }], topics: [], main_path_end_id: c };
    expect(() => validateConversationMap(graph, [a, b, c])).not.toThrow();
    expect(() => validateConversationMap({ ...graph, nodes: [{ ...graph.nodes[0], parent_id: c }, ...graph.nodes.slice(1)] }, [a, b, c])).toThrow();
    expect(() => validateConversationMap(graph, [a, b])).toThrow("not in this conversation");
  });

  it("remaps cloned thread and current reply references without changing external links", () => {
    const ids = new Map([[a, b], ["current", c]]);
    expect(remapConversationOutline(`[Earlier](#message-${a}) [Now](#message-current) [Web](https://example.com)`, ids))
      .toBe(`[Earlier](#message-${b}) [Now](#message-${c}) [Web](https://example.com)`);
    expect(remapConversationMap({ nodes: [{ id: "current", parent_id: a, topic_id: null }], topics: [], main_path_end_id: "current" }, ids))
      .toMatchObject({ nodes: [{ id: c, parent_id: b }], main_path_end_id: c });
  });

  it("requires short single-line summaries", () => {
    expect(turnSummarySchema.parse(" Explain induction ")).toBe("Explain induction");
    for (const invalid of ["", "First\nSecond", "x".repeat(161)]) expect(turnSummarySchema.safeParse(invalid).success).toBe(false);
  });
});
