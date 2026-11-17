import { describe, expect, it } from "vitest";
import { createTestServerRunState } from "./test-run-environment.test-fixtures.js";
import { createModelFallbackActivator } from "./model-fallback.js";

function fixture() {
  const state = createTestServerRunState({ model: "primary", environmentPayload: { responses: { temperature: 0.4 } },
    snapshot: { platform_model_metadata: {
      default: {}, primary: { fallbackModels: ["primary", "legacy", "backup", "backup", "last"] },
      legacy: { context_management: "v1" },
      backup: { type: "claude", context_window: 200_000, compatibility: ["disablePdfFile"], fallbackModels: ["unapproved"] },
      last: { type: "google", context_window: 1_000_000 }
    } }
  });
  state.bootstrap.runtime.requestedContextManagementVersion = "v2";
  state.bootstrap.runtime.modelPayload = { reasoning: { effort: "high" }, max_output_tokens: 100_000 };
  state.bootstrap.runtime.environmentPayload = { responses: state.bootstrap.runtime.modelPayload, persistent_runtime: { enabled: true } };
  return { state, activate: createModelFallbackActivator(() => state) };
}

describe("model fallback route", () => {
  it("resolves each target's metadata while preserving the active request and environment payloads", async () => {
    const { state, activate } = fixture();
    const original = structuredClone(state.bootstrap.runtime);
    const route = await activate("primary");
    expect(route).toMatchObject({ model: "backup", quickModel: "backup", modelType: "claude", maxContextTokens: 200_000,
      compatibilityModes: ["disablePdfFile"], modelPayload: original.modelPayload,
      providerKind: "platform", providerBaseUrl: state.provider.baseUrl });
    expect(route?.modelPayload).toEqual(original.modelPayload);
    expect(route?.environmentPayload).toEqual(original.environmentPayload);
    expect(state.bootstrap.runtime).toBe(route);
    const last = await activate("backup");
    expect(last).toMatchObject({ model: "last", modelType: "google", maxContextTokens: 1_000_000 });
    expect(last?.modelPayload).toEqual(original.modelPayload);
    expect(last?.environmentPayload).toEqual(original.environmentPayload);
  });

  it("uses only the original ordered list, skips v1, and stops after each candidate once", async () => {
    const { activate } = fixture();
    expect(await activate("arbitrary-model")).toBeNull();
    expect((await activate("primary"))?.model).toBe("backup");
    expect((await activate("primary"))?.model).toBe("backup");
    expect((await activate("backup"))?.model).toBe("last");
    expect(await activate("last")).toBeNull();
  });

  it("leaves v1 routes unchanged", async () => {
    const { state, activate } = fixture();
    state.bootstrap.runtime.requestedContextManagementVersion = "v1";
    expect(await activate("primary")).toBeNull();
    expect(state.bootstrap.runtime.model).toBe("primary");
  });
});
