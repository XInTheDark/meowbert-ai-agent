import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/config.js", () => ({ config: { memory: { embeddings: {} } } }));
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";
import { resolveMemoryEmbeddingConfig } from "./indexing.js";

beforeEach(() => {
  vi.resetAllMocks();
  config.memory!.embeddings = {};
});

describe("memory embedding provider", () => {
  it("uses the selected provider and changes the index hash after switching endpoints", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ base_url: "https://one.test/v1", api_key: "one" }] } as never);
    const first = await resolveMemoryEmbeddingConfig();
    expect(first.provider).toEqual({ baseUrl: "https://one.test/v1", apiKey: "one" });
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ base_url: "https://two.test/v1", api_key: "two" }] } as never);
    const second = await resolveMemoryEmbeddingConfig();
    expect(second.provider).toEqual({ baseUrl: "https://two.test/v1", apiKey: "two" });
    expect(second.configHash).not.toBe(first.configHash);
  });

  it("keeps explicit embedding credentials independent of platform selection", async () => {
    config.memory!.embeddings = { baseUrl: "https://embeddings.test/v1", apiKey: "embedding-key" };
    expect((await resolveMemoryEmbeddingConfig()).provider).toEqual(config.memory!.embeddings);
    expect(query).not.toHaveBeenCalled();
  });

  it("reports how to configure a provider when no default is selected", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    await expect(resolveMemoryEmbeddingConfig()).rejects.toThrow("Admin → AI providers");
  });
});
