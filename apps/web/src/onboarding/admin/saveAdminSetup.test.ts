import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../lib/api";
import { saveAdminSetup } from "./saveAdminSetup";

function fakeApi() {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const existingSettings = {
    allowUserSignup: false,
    requireAdminSignupApproval: false,
    debugMode: false,
    agentPresets: [{ id: "default" }, { id: "deep-think" }],
    modelSliderAgentIds: ["default", "deep-think"],
    specializedModels: { internalModel: null, fastModel: null, memorySynthesisAgent: null, reviewerAgent: null, subagentFastAgent: null }
  };
  const api = {
    get: vi.fn(async (path: string) => { calls.push({ method: "GET", path }); return { settings: existingSettings }; }),
    post: vi.fn(async (path: string, body?: unknown) => { calls.push({ method: "POST", path, body }); return {}; }),
    patch: vi.fn(async (path: string, body?: unknown) => { calls.push({ method: "PATCH", path, body }); return {}; })
  } as unknown as ApiClient;
  return { api, calls };
}

describe("saveAdminSetup", () => {
  it("adds the provider, then saves models, background models, and sign-up policy", async () => {
    const { api, calls } = fakeApi();

    await saveAdminSetup(api, {
      provider: { baseUrl: "https://llm.example.com/v1", apiKey: "test-key" },
      models: [{ modelId: "big-model", reasoningEffort: "high" }, { modelId: "small-model", reasoningEffort: "off" }],
      internalModel: "small-model",
      fastModel: "small-model",
      signupPolicy: "approval"
    });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/admin/ai-providers",
      "GET /api/admin/settings",
      "PATCH /api/admin/settings"
    ]);
    const body = calls[2].body as Record<string, any>;
    expect(body.agentPresets.map((preset: { id: string }) => preset.id)).toEqual(["default", "small-model"]);
    expect(body.modelSliderAgentIds).toEqual(["default"]);
    expect(body.specializedModels).toMatchObject({ internalModel: "small-model", fastModel: "small-model" });
    expect(body).toMatchObject({ allowUserSignup: true, requireAdminSignupApproval: true, debugMode: false });
  });
});
