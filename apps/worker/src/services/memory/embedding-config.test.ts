import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
import { query } from "../../lib/db.js";
import { resolveMemoryEmbeddingConfig } from "./embedding-config.js";

const settingsRow = {
  model: "text-embedding-3-small",
  document_template: null,
  query_template: null,
  index_generation: 1,
  base_url: null,
  api_key: null
};

function mockQueries(...results: Array<Array<Record<string, unknown>>>) {
  for (const rows of results) {
    vi.mocked(query).mockResolvedValueOnce({ rows } as never);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("memory embedding config", () => {
  it("follows the selected provider when none is pinned without invalidating indexes", async () => {
    mockQueries([settingsRow], [{ base_url: "https://one.test/v1", api_key: "one" }]);
    const first = await resolveMemoryEmbeddingConfig();
    expect(first.provider).toEqual({ baseUrl: "https://one.test/v1", apiKey: "one" });

    mockQueries([settingsRow], [{ base_url: "https://two.test/v1", api_key: "two" }]);
    const second = await resolveMemoryEmbeddingConfig();
    expect(second.provider).toEqual({ baseUrl: "https://two.test/v1", apiKey: "two" });
    expect(second.configHash).toBe(first.configHash);
  });

  it("keeps existing indexes when the model or templates change", async () => {
    const pinned = { ...settingsRow, base_url: "https://embed.test/v1", api_key: "key" };
    mockQueries([pinned]);
    const before = await resolveMemoryEmbeddingConfig();
    mockQueries([{ ...pinned, model: "embeddinggemma-2:270m", query_template: "task: search result | query: {text}" }]);
    const after = await resolveMemoryEmbeddingConfig();
    expect(after.model).toBe("embeddinggemma-2:270m");
    expect(after.configHash).toBe(before.configHash);
  });

  it("uses a pinned provider without consulting the selected one", async () => {
    mockQueries([{ ...settingsRow, base_url: "https://embed.test/v1", api_key: "key" }]);
    expect((await resolveMemoryEmbeddingConfig()).provider).toEqual({ baseUrl: "https://embed.test/v1", apiKey: "key" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("changes the index hash when an admin re-embeds", async () => {
    const pinned = { ...settingsRow, base_url: "https://embed.test/v1", api_key: "key" };
    mockQueries([pinned]);
    const before = await resolveMemoryEmbeddingConfig();
    mockQueries([{ ...pinned, index_generation: 2 }]);
    expect((await resolveMemoryEmbeddingConfig()).configHash).not.toBe(before.configHash);
  });

  it("reports how to configure a provider when none is selected", async () => {
    mockQueries([settingsRow], []);
    await expect(resolveMemoryEmbeddingConfig()).rejects.toThrow("Admin → AI providers");
  });
});
