import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
import { query } from "../../lib/db.js";
import { resolveRuntimeAiProvider } from "./runtime-provider.js";

beforeEach(() => { vi.resetAllMocks(); });

describe("runtime AI provider resolution", () => {
  it("uses the database selection for each new run and retains the resolved connection for an existing run", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ base_url: "https://one.test/v1", api_key: "one" }] } as never);
    const first = await resolveRuntimeAiProvider();
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ base_url: "https://two.test/v1", api_key: "two" }] } as never);
    expect(await resolveRuntimeAiProvider()).toEqual({ baseUrl: "https://two.test/v1", apiKey: "two", supportsNativeCompaction: true });
    expect(first).toEqual({ baseUrl: "https://one.test/v1", apiKey: "one", supportsNativeCompaction: true });
  });

  it("preserves personal BYO credentials even when no platform provider is selected", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    expect(await resolveRuntimeAiProvider({ baseUrl: "https://byo.test/v1", apiKey: "personal" }))
      .toMatchObject({ baseUrl: "https://byo.test/v1", apiKey: "personal" });
  });

  it("retains compaction support for BYO connections sharing the platform endpoint", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ base_url: "https://same.test/v1", api_key: "platform" }] } as never);
    expect(await resolveRuntimeAiProvider({ baseUrl: "https://same.test/v1/", apiKey: "personal" }))
      .toEqual({ baseUrl: "https://same.test/v1/", apiKey: "personal", supportsNativeCompaction: true });
  });

  it("preserves ChatGPT credentials and headers without reading platform credentials", async () => {
    const provider = { baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "oauth", chatGptCodex: true,
      defaultHeaders: { "ChatGPT-Account-Id": "account" } };
    expect(await resolveRuntimeAiProvider(provider)).toBe(provider);
    expect(query).not.toHaveBeenCalled();
  });

  it("fails clearly when a platform run has no selected provider", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    await expect(resolveRuntimeAiProvider()).rejects.toThrow("Admin → AI providers");
  });
});
