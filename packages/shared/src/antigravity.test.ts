import { describe, expect, it } from "vitest";
import {
  normalizePlatformModelMetadata,
  resolveAgyAcpConfigForModel,
  resolveIdleCompactionForModel,
  resolveModelTypeForModel
} from "./model-metadata.js";
import {
  decryptAntigravitySecret,
  encryptAntigravitySecret,
  parseAntigravityTokenExpiry
} from "./antigravity-crypto.js";

describe("agy_acp model metadata", () => {
  it("normalizes agy_acp model type and optional agy_model / agy_thinking_level", () => {
    const metadata = normalizePlatformModelMetadata({
      default: { context_window: 256000, type: "openai" },
      "gemini-3.1-pro-acp": {
        type: "agy_acp",
        agy_model: "gemini-3.1-pro",
        agy_thinking_level: "high"
      }
    });

    expect(resolveModelTypeForModel("gemini-3.1-pro-acp", metadata)).toBe("agy_acp");
    expect(resolveAgyAcpConfigForModel("gemini-3.1-pro-acp", metadata)).toEqual({
      agyModel: "gemini-3.1-pro",
      agyThinkingLevel: "high"
    });
    expect(resolveIdleCompactionForModel("gemini-3.1-pro-acp", metadata).promptCacheTtlSeconds).toBe(900);
  });

  it("falls back to the model key when agy_model is omitted", () => {
    const metadata = normalizePlatformModelMetadata({
      "gemini-3.1-pro": { type: "agy_acp" }
    });
    expect(resolveAgyAcpConfigForModel("gemini-3.1-pro", metadata)).toEqual({
      agyModel: "gemini-3.1-pro",
      agyThinkingLevel: null
    });
  });
});

describe("antigravity credential crypto", () => {
  it("round-trips AES-256-GCM encrypted payloads and rejects tampered ciphertext", () => {
    const secret = "test-jwt-secret-value";
    const plaintext = JSON.stringify({ token: { access_token: "abc", refresh_token: "def" } });
    const ciphertext = encryptAntigravitySecret(plaintext, secret);

    expect(ciphertext).not.toContain("abc");
    expect(decryptAntigravitySecret(ciphertext, secret)).toBe(plaintext);
    expect(() => decryptAntigravitySecret(ciphertext, "wrong-secret")).toThrow();
  });

  it("parses ISO/RFC3339 token expiry timestamps", () => {
    const raw = JSON.stringify({
      token: { expiry: "2026-11-23T21:40:58.988336183+08:00" },
      auth_method: "consumer"
    });
    expect(parseAntigravityTokenExpiry(raw)).toBe("2026-11-23T13:40:58.988Z");
    expect(parseAntigravityTokenExpiry("not-json")).toBeNull();
  });
});
