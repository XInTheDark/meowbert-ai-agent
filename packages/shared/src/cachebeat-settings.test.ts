import { describe, expect, it } from "vitest";
import { normalizeCachebeatSettings } from "./cachebeat-settings.js";

describe("normalizeCachebeatSettings", () => {
  it("keeps the provider beats go through", () => {
    const id = "6f1c2a4e-1b2c-4d5e-8f90-1234567890ab";
    expect(normalizeCachebeatSettings({ mode: "smart", durationSeconds: 3600, providerId: id }).providerId).toBe(id);
  });

  it("sends beats to the selected provider when none is picked, including settings saved before the choice existed", () => {
    expect(normalizeCachebeatSettings({ mode: "fixed", durationSeconds: 3600 }).providerId).toBeNull();
    expect(normalizeCachebeatSettings({ mode: "fixed", durationSeconds: 3600, providerId: "  " }).providerId).toBeNull();
  });
});
