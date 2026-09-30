import { describe, expect, it, vi } from "vitest";
import { aiProviderInputSchema, readSelectedAiProvider, requireSelectedAiProvider } from "./ai-providers.js";

describe("AI providers", () => {
  it("accepts and trims HTTP-compatible provider credentials", () => {
    expect(aiProviderInputSchema.parse({ baseUrl: " http://localhost:8080/v1 ", apiKey: " key " }))
      .toEqual({ baseUrl: "http://localhost:8080/v1", apiKey: "key" });
  });

  it.each(["not a URL", "ftp://example.com", "https://user:secret@example.com", "https://example.com?key=secret", "https://example.com#key"])(
    "rejects an invalid or credential-bearing base URL: %s", (baseUrl) => {
      expect(aiProviderInputSchema.safeParse({ baseUrl, apiKey: "key" }).success).toBe(false);
    }
  );

  it("requires a nonblank key and accepts no extra provider fields", () => {
    expect(aiProviderInputSchema.safeParse({ baseUrl: "https://example.com", apiKey: " " }).success).toBe(false);
    expect(aiProviderInputSchema.safeParse({ baseUrl: "https://example.com", apiKey: "key", model: "extra" }).success).toBe(false);
  });

  it("reads the current selection again after switching providers", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ base_url: "https://one.test/v1", api_key: "one" }] })
      .mockResolvedValueOnce({ rows: [{ base_url: "https://two.test/v1", api_key: "two" }] });
    expect(await requireSelectedAiProvider(query)).toEqual({ baseUrl: "https://one.test/v1", apiKey: "one" });
    expect(await requireSelectedAiProvider(query)).toEqual({ baseUrl: "https://two.test/v1", apiKey: "two" });
  });

  it("returns no connection or an actionable task error when none is selected", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await readSelectedAiProvider(query)).toBeNull();
    await expect(requireSelectedAiProvider(query)).rejects.toThrow("Admin → AI providers");
  });
});
