import { describe, expect, it } from "vitest";
import { routeWithRules } from "./routing.js";

describe("routeWithRules", () => {
  it("prefers prefix rule over defaults", () => {
    const decision = routeWithRules({
      message: "env:analytics summarize this",
      environments: [
        { id: "1", name: "default" },
        { id: "2", name: "analytics" }
      ],
      rules: [
        {
          id: "a",
          priority: 2,
          ruleType: "default_env",
          enabled: true,
          ruleJson: { environmentId: "1" }
        },
        {
          id: "b",
          priority: 1,
          ruleType: "prefix_env",
          enabled: true,
          ruleJson: { prefix: "env:" }
        }
      ]
    });

    expect(decision?.environmentId).toBe("2");
    expect(decision?.matchedRuleId).toBe("b");
  });

  it("falls back to default when no explicit match exists", () => {
    const decision = routeWithRules({
      message: "hello",
      environments: [{ id: "1", name: "default" }],
      rules: [
        {
          id: "a",
          priority: 1,
          ruleType: "default_env",
          enabled: true,
          ruleJson: { environmentId: "1" }
        }
      ]
    });

    expect(decision?.environmentId).toBe("1");
    expect(decision?.reason).toBe("default");
  });
});
