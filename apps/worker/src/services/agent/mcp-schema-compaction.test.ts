import { describe, expect, it } from "vitest";
import { compactToolInputSchema } from "./mcp-schema-compaction.js";

const tabId = { anyOf: [{ type: "string" }, { type: "null" }], default: null, description: "Optional tab ID." };

describe("compactToolInputSchema", () => {
  it("drops the null branch and null default from optional fields", () => {
    expect(compactToolInputSchema({
      type: "object",
      properties: { tab_id: tabId, mode: { anyOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" }], default: null } },
      required: []
    })).toEqual({
      type: "object",
      properties: { tab_id: { type: "string", description: "Optional tab ID." }, mode: { type: "string", enum: ["a", "b"] } },
      required: []
    });
  });

  it("keeps null accepted for required nullable fields", () => {
    const schema = compactToolInputSchema({
      type: "object",
      properties: {
        note: { anyOf: [{ type: "string" }, { type: "null" }] },
        choice: { anyOf: [{ type: "string", enum: ["a"] }, { type: "null" }] }
      },
      required: ["note", "choice"]
    });

    expect(schema.properties).toEqual({
      note: { type: ["string", "null"] },
      choice: { anyOf: [{ type: "string", enum: ["a"] }, { type: "null" }] }
    });
  });

  it("describes a field shared by oneOf variants once", () => {
    const variant = (type: string) => ({
      type: "object",
      properties: { type: { const: type, type: "string" }, tab_id: tabId },
      required: ["type"]
    });
    const schema = compactToolInputSchema({
      type: "object",
      properties: { operations: { type: "array", items: { oneOf: [variant("insert"), variant("delete")] } } },
      required: ["operations"]
    }) as { properties: { operations: { items: { oneOf: Array<{ properties: Record<string, unknown> }> } } } };

    const [first, second] = schema.properties.operations.items.oneOf;
    expect(first.properties.tab_id).toEqual({ type: "string", description: "Optional tab ID." });
    expect(second.properties.tab_id).toEqual({ type: "string" });
  });

  it("treats property names as names, not schema keywords", () => {
    const schema = compactToolInputSchema({
      type: "object",
      properties: { default: { type: "string" }, anyOf: { type: "number" } },
      required: ["default", "anyOf"]
    });

    expect(schema.properties).toEqual({ default: { type: "string" }, anyOf: { type: "number" } });
  });
});
