import { describe, expect, it } from "vitest";
import {
  createDefaultEnvironmentJsonPayload,
  extractResponsesApiPayload,
  normalizeAgentPresetPayload,
  normalizeEnvironmentResponsesSettings
} from "./responses-settings.js";

describe("createDefaultEnvironmentJsonPayload", () => {
  it("returns the nested responses default shape", () => {
    expect(createDefaultEnvironmentJsonPayload()).toEqual({
      responses: {
        reasoning: {
          effort: "high",
          summary: "detailed"
        },
        store: false
      }
    });
  });
});

describe("normalizeEnvironmentResponsesSettings", () => {
  it("moves non-environment keys into responses", () => {
    expect(
      normalizeEnvironmentResponsesSettings({
        reasoning: { effort: "high" },
        store: false,
        memory: { enabled: true }
      })
    ).toEqual({
      responses: {
        reasoning: { effort: "high" },
        store: false
      },
      memory: { enabled: true }
    });
  });

  it("preserves arbitrary provider payload inside responses without filtering", () => {
    expect(
      normalizeEnvironmentResponsesSettings({
        responses: {
          reasoning: { effort: "xhigh" },
          custom_provider_flag: true,
          nested: { mode: "test" }
        },
        sandbox: { network_enabled: false }
      })
    ).toEqual({
      responses: {
        reasoning: { effort: "xhigh" },
        custom_provider_flag: true,
        nested: { mode: "test" }
      },
      sandbox: { network_enabled: false }
    });
  });

  it("keeps project context notes top-level", () => {
    expect(
      normalizeEnvironmentResponsesSettings({
        store: false,
        project_context: {
          notes: {
            "context/docs/spec.md": "Read first."
          }
        }
      })
    ).toEqual({
      responses: {
        store: false
      },
      project_context: {
        notes: {
          "context/docs/spec.md": "Read first."
        }
      }
    });
  });
});

describe("normalizeAgentPresetPayload", () => {
  it("keeps model top-level and moves the rest into responses", () => {
    expect(
      normalizeAgentPresetPayload({
        model: "gpt-5.4",
        reasoning: { effort: "xhigh" },
        custom_provider_flag: true
      })
    ).toEqual({
      model: "gpt-5.4",
      responses: {
        reasoning: { effort: "xhigh" },
        custom_provider_flag: true
      }
    });
  });
});

describe("extractResponsesApiPayload", () => {
  it("returns responses as-is when present", () => {
    expect(
      extractResponsesApiPayload({
        responses: {
          reasoning: { effort: "high" },
          custom_provider_flag: true,
          nested: { mode: "abc" }
        },
        sandbox: { network_enabled: false }
      })
    ).toEqual({
      reasoning: { effort: "high", summary: "detailed" },
      custom_provider_flag: true,
      nested: { mode: "abc" }
    });
  });

  it("preserves an explicit reasoning summary mode", () => {
    expect(
      extractResponsesApiPayload({
        responses: {
          reasoning: {
            effort: "high",
            summary: "concise"
          }
        }
      })
    ).toEqual({
      reasoning: {
        effort: "high",
        summary: "concise"
      }
    });
  });

  it("returns an empty payload when responses is missing", () => {
    expect(
      extractResponsesApiPayload({
        reasoning: { effort: "high" },
        memory: { enabled: true }
      })
    ).toEqual({});
  });
});
