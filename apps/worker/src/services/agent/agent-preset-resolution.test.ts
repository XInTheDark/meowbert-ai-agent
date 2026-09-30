import { describe, expect, it } from "vitest";
import type { PlatformAgentPreset } from "@meowbert/shared";
import type { TaskMessageRow } from "./types.js";
import {
  resolveEffectiveRunAgentPreset,
  resolveMemorySynthesisAgentPreset,
  resolveReviewerAgentPreset
} from "./agent-preset-resolution.js";

function createMessage(input: {
  id: string;
  role: TaskMessageRow["role"];
  text: string;
  agentId?: string;
}): TaskMessageRow {
  return {
    id: input.id,
    role: input.role,
    content_json: {
      text: input.text,
      ...(input.agentId ? { agent: { id: input.agentId } } : {})
    },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: "2026-03-19T00:00:00.000Z"
  };
}

const visibleAgentPresets: PlatformAgentPreset[] = [
  {
    id: "default",
    name: "Auto",
    description: "Routes automatically.",
    requiresSuperAdmin: false,
    payload: {
      model: "router-v1"
    }
  },
  {
    id: "fast",
    name: "Fast",
    description: "Quick work.",
    requiresSuperAdmin: false,
    payload: {
      model: "gpt-5.4-mini"
    }
  }
];

describe("resolveEffectiveRunAgentPreset", () => {
  it("uses the explicit latest user agent selection when present", () => {
    const resolved = resolveEffectiveRunAgentPreset(
      [
        createMessage({ id: "m1", role: "user", text: "first", agentId: "default" }),
        createMessage({ id: "m2", role: "assistant", text: "ok" }),
        createMessage({ id: "m3", role: "user", text: "second", agentId: "fast" })
      ],
      visibleAgentPresets
    );

    expect(resolved?.id).toBe("fast");
  });

  it("falls back to the default preset when there is no explicit agent selection", () => {
    const resolved = resolveEffectiveRunAgentPreset(
      [
        createMessage({ id: "m1", role: "user", text: "connector message" }),
        createMessage({ id: "m2", role: "assistant", text: "ok" })
      ],
      visibleAgentPresets
    );

    expect(resolved?.id).toBe("default");
    expect(resolved?.payload).toEqual({ model: "router-v1" });
  });

  it("uses the workspace default agent when no agent was chosen", () => {
    const connectorMessage = [createMessage({ id: "m1", role: "user", text: "connector message" })];
    const swarm: PlatformAgentPreset = {
      id: "swarm", name: "Swarm", description: "", requiresSuperAdmin: false, mode: "agent_swarm", payload: {}
    };

    expect(resolveEffectiveRunAgentPreset(connectorMessage, visibleAgentPresets, "fast")?.id).toBe("fast");
    expect(resolveEffectiveRunAgentPreset(
      [createMessage({ id: "m2", role: "user", text: "explicit", agentId: "default" })],
      visibleAgentPresets,
      "fast"
    )?.id).toBe("default");
    expect(resolveEffectiveRunAgentPreset(connectorMessage, visibleAgentPresets, "unavailable")?.id).toBe("default");
    expect(resolveEffectiveRunAgentPreset(connectorMessage, [...visibleAgentPresets, swarm], "swarm")?.id).toBe("default");
  });

  it("falls back to the default preset when the explicit selection is missing", () => {
    const resolved = resolveEffectiveRunAgentPreset(
      [createMessage({ id: "m1", role: "user", text: "run this", agentId: "unknown" })],
      visibleAgentPresets
    );

    expect(resolved?.id).toBe("default");
  });

  it("returns null when there are no visible presets", () => {
    const resolved = resolveEffectiveRunAgentPreset(
      [createMessage({ id: "m1", role: "user", text: "run this" })],
      []
    );

    expect(resolved).toBeNull();
  });
});

describe("resolveMemorySynthesisAgentPreset", () => {
  it("uses the configured preset and falls back to the default when it is unavailable", () => {
    expect(resolveMemorySynthesisAgentPreset("fast", visibleAgentPresets)?.id).toBe("fast");
    expect(resolveMemorySynthesisAgentPreset("unknown", visibleAgentPresets)?.id).toBe("default");
    expect(resolveMemorySynthesisAgentPreset(null, visibleAgentPresets)?.id).toBe("default");
  });
});

describe("resolveReviewerAgentPreset", () => {
  it("uses the configured reviewer preset and falls back to the default when it is unavailable", () => {
    expect(resolveReviewerAgentPreset("fast", visibleAgentPresets)?.id).toBe("fast");
    expect(resolveReviewerAgentPreset("unknown", visibleAgentPresets)?.id).toBe("default");
    expect(resolveReviewerAgentPreset(null, visibleAgentPresets)?.id).toBe("default");
  });
});
