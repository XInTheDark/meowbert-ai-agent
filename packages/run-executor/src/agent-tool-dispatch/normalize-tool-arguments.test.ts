import { describe, expect, it } from "vitest";
import { buildExecTool, execArgumentsSchema } from "../code-mode/exec-tool.js";
import { normalizeToolArguments, normalizeToolArgumentsText } from "./normalize-tool-arguments.js";

const schema = {
  type: "object",
  properties: {
    label: { type: "string" },
    limit: { type: ["number", "null"] },
    count: { type: "integer" },
    pages: { type: "array", items: { type: "integer" } },
    nested: { type: "object", properties: { delay: { type: "number" }, note: { type: ["string", "null"] } } }
  }
};

describe("normalizeToolArguments", () => {
  it("turns quoted numbers into numbers where the schema expects them", () => {
    expect(normalizeToolArguments(schema, {
      label: "100",
      limit: " 2.5 ",
      count: "7",
      pages: ["1", 2],
      nested: { delay: "1e3", note: "5" }
    })).toEqual({ label: "100", limit: 2.5, count: 7, pages: [1, 2], nested: { delay: 1000, note: "5" } });
  });

  it("leaves strings that are not clean numbers for the handler to reject", () => {
    expect(normalizeToolArguments(schema, { limit: "10px", count: "1.5", pages: [""] }))
      .toMatchObject({ limit: "10px", count: "1.5", pages: [""] });
  });

  it("fills omitted nullable keys with null but not required non-nullable ones", () => {
    const result = normalizeToolArguments(schema, { label: "x" });
    expect(result).toMatchObject({ label: "x", limit: null });
    expect(result).not.toHaveProperty("count");
  });

  it("lets an exec call omit timeout_seconds or quote it", () => {
    const parameters = buildExecTool([], 600).parameters;
    const omitted = JSON.parse(normalizeToolArgumentsText(parameters, JSON.stringify({ code: "return 1" })));
    expect(execArgumentsSchema.parse(omitted)).toMatchObject({ timeout_seconds: null, summary: null });
    const quoted = JSON.parse(normalizeToolArgumentsText(parameters, JSON.stringify({ code: "return 1", timeout_seconds: "100", summary: null })));
    expect(execArgumentsSchema.parse(quoted).timeout_seconds).toBe(100);
  });

  it("returns malformed JSON unchanged", () => {
    expect(normalizeToolArgumentsText(schema, "{oops")).toBe("{oops");
  });
});
