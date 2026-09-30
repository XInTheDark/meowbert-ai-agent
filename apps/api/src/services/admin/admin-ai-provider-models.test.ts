import { describe, expect, it, vi } from "vitest";
import { ProviderModelListError, listProviderModels } from "./admin-ai-provider-models.js";

const provider = { baseUrl: "https://llm.example.com/v1/", apiKey: "test-key" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("listProviderModels", () => {
  it("returns sorted unique model ids from the provider's /models endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      data: [{ id: "gpt-b" }, { id: "gpt-a" }, { id: "gpt-b" }, { object: "model" }]
    }));

    await expect(listProviderModels(provider, fetchImpl)).resolves.toEqual(["gpt-a", "gpt-b"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://llm.example.com/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer test-key" } })
    );
  });

  it("reports a rejected API key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "unauthorized" }));

    await expect(listProviderModels(provider, fetchImpl)).rejects.toThrow("rejected the API key");
  });

  it("reports responses that are not a model list", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { models: [] }));

    await expect(listProviderModels(provider, fetchImpl)).rejects.toBeInstanceOf(ProviderModelListError);
  });
});
