import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
import { query } from "../../lib/db.js";
import { getPlatformAiClient } from "./ai-provider-client.js";

describe("platform AI client", () => {
  it("uses the currently selected URL and key without restarting the API", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ base_url: "https://one.test/v1", api_key: "one" }] } as never);
    const first = await getPlatformAiClient();
    expect(first?.baseURL).toBe("https://one.test/v1");
    expect(first?.apiKey).toBe("one");
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ base_url: "https://two.test/v1", api_key: "two" }] } as never);
    const second = await getPlatformAiClient();
    expect(second?.baseURL).toBe("https://two.test/v1");
    expect(second?.apiKey).toBe("two");
  });

  it("lets connector routing use its existing fallback when no provider is selected", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    expect(await getPlatformAiClient()).toBeNull();
  });
});
