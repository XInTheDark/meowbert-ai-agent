import { describe, expect, it } from "vitest";
import {
  getSandboxNetworkEnabled,
  matchesEnvPassthroughPattern,
  selectSandboxPassthroughEnv,
  setSandboxNetworkEnabled
} from "./sandbox.js";

describe("sandbox payload helpers", () => {
  it("defaults sandbox networking to enabled", () => {
    expect(getSandboxNetworkEnabled({})).toBe(true);
  });

  it("reads both snake_case and camelCase network flags", () => {
    expect(getSandboxNetworkEnabled({ sandbox: { network_enabled: false } })).toBe(false);
    expect(getSandboxNetworkEnabled({ sandbox: { networkEnabled: false } })).toBe(false);
  });

  it("writes the sparse false-only canonical form", () => {
    expect(setSandboxNetworkEnabled({ sandbox: { mode: "default" } }, false)).toEqual({
      sandbox: {
        mode: "default",
        network_enabled: false
      }
    });

    expect(setSandboxNetworkEnabled({ sandbox: { mode: "default", network_enabled: false } }, true)).toEqual({
      sandbox: {
        mode: "default"
      }
    });
  });
});

describe("sandbox env passthrough", () => {
  it("matches wildcard passthrough patterns", () => {
    expect(matchesEnvPassthroughPattern("SSL_CERT_FILE", "SSL_CERT_*")).toBe(true);
    expect(matchesEnvPassthroughPattern("HTTP_PROXY", "HTTPS_PROXY")).toBe(false);
  });

  it("selects only explicitly allowed env vars", () => {
    expect(
      selectSandboxPassthroughEnv(
        {
          HTTP_PROXY: "http://proxy.example",
          HTTPS_PROXY: "https://proxy.example",
          SECRET_TOKEN: "should-not-pass"
        },
        ["HTTP_PROXY", "SSL_CERT_*"]
      )
    ).toEqual({
      HTTP_PROXY: "http://proxy.example"
    });
  });
});
