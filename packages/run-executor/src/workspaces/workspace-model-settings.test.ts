import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceCompactionBackend,
  resolveWorkspaceContextManagementToolsEnabled,
  resolveWorkspaceMcpTimeoutMs,
  resolveWorkspaceModelRequestTimeoutMs,
  resolveWorkspaceShellToolMaxTimeoutMs
} from "./workspace-model-settings.js";

describe("resolveWorkspaceModelRequestTimeoutMs", () => {
  it("defaults to 5 minutes when unset", () => {
    expect(resolveWorkspaceModelRequestTimeoutMs(undefined)).toBe(300_000);
    expect(resolveWorkspaceModelRequestTimeoutMs({})).toBe(300_000);
  });

  it("uses modelRequestTimeoutMs when provided", () => {
    expect(resolveWorkspaceModelRequestTimeoutMs({ modelRequestTimeoutMs: 120_000 })).toBe(120_000);
    expect(resolveWorkspaceModelRequestTimeoutMs({ modelRequestTimeoutMs: "240000" })).toBe(240_000);
  });

  it("supports hardTimeout aliases for backward compatibility", () => {
    expect(resolveWorkspaceModelRequestTimeoutMs({ hardTimeoutMs: 75_000 })).toBe(75_000);
    expect(resolveWorkspaceModelRequestTimeoutMs({ hardTimeoutSeconds: 600 })).toBe(600_000);
  });

  it("falls back to default when configured timeout is invalid", () => {
    expect(resolveWorkspaceModelRequestTimeoutMs({ modelRequestTimeoutMs: 0 })).toBe(300_000);
    expect(resolveWorkspaceModelRequestTimeoutMs({ modelRequestTimeoutMs: -1 })).toBe(300_000);
    expect(resolveWorkspaceModelRequestTimeoutMs({ modelRequestTimeoutMs: "abc" })).toBe(300_000);
  });
});

describe("resolveWorkspaceShellToolMaxTimeoutMs", () => {
  it("defaults to 5 minutes when unset", () => {
    expect(resolveWorkspaceShellToolMaxTimeoutMs(undefined)).toBe(300_000);
    expect(resolveWorkspaceShellToolMaxTimeoutMs({})).toBe(300_000);
  });

  it("uses shellToolMaxTimeoutMs when provided", () => {
    expect(resolveWorkspaceShellToolMaxTimeoutMs({ shellToolMaxTimeoutMs: 90_000 })).toBe(90_000);
    expect(resolveWorkspaceShellToolMaxTimeoutMs({ shellToolMaxTimeoutMs: "123000" })).toBe(123_000);
  });

  it("supports shellToolMaxTimeoutSeconds alias", () => {
    expect(resolveWorkspaceShellToolMaxTimeoutMs({ shellToolMaxTimeoutSeconds: 75 })).toBe(75_000);
  });

  it("falls back to default when configured timeout is invalid", () => {
    expect(resolveWorkspaceShellToolMaxTimeoutMs({ shellToolMaxTimeoutMs: 0 })).toBe(300_000);
    expect(resolveWorkspaceShellToolMaxTimeoutMs({ shellToolMaxTimeoutMs: -1 })).toBe(300_000);
    expect(resolveWorkspaceShellToolMaxTimeoutMs({ shellToolMaxTimeoutMs: "abc" })).toBe(300_000);
  });
});

describe("resolveWorkspaceMcpTimeoutMs", () => {
  it("defaults to 1 minute when unset", () => {
    expect(resolveWorkspaceMcpTimeoutMs(undefined)).toBe(60_000);
    expect(resolveWorkspaceMcpTimeoutMs({})).toBe(60_000);
  });

  it("uses mcpTimeoutMs when provided", () => {
    expect(resolveWorkspaceMcpTimeoutMs({ mcpTimeoutMs: 90_000 })).toBe(90_000);
    expect(resolveWorkspaceMcpTimeoutMs({ mcpTimeoutMs: "123000" })).toBe(123_000);
  });

  it("supports mcpTimeoutSeconds alias", () => {
    expect(resolveWorkspaceMcpTimeoutMs({ mcpTimeoutSeconds: 75 })).toBe(75_000);
  });

  it("falls back to default when configured timeout is invalid", () => {
    expect(resolveWorkspaceMcpTimeoutMs({ mcpTimeoutMs: 0 })).toBe(60_000);
    expect(resolveWorkspaceMcpTimeoutMs({ mcpTimeoutMs: -1 })).toBe(60_000);
    expect(resolveWorkspaceMcpTimeoutMs({ mcpTimeoutMs: "abc" })).toBe(60_000);
  });
});

describe("resolveWorkspaceCompactionBackend", () => {
  it("defaults to native when unset", () => {
    expect(resolveWorkspaceCompactionBackend(undefined)).toBe("native");
    expect(resolveWorkspaceCompactionBackend({})).toBe("native");
  });

  it("returns summary for the explicit backend setting", () => {
    expect(resolveWorkspaceCompactionBackend({ contextCompactionBackend: "summary" })).toBe("summary");
    expect(resolveWorkspaceCompactionBackend({ contextCompactionBackend: "SUMMARY" })).toBe("summary");
  });

  it("returns native for the explicit backend setting", () => {
    expect(resolveWorkspaceCompactionBackend({ contextCompactionBackend: "native" })).toBe("native");
    expect(resolveWorkspaceCompactionBackend({ contextCompactionBackend: "NATIVE" })).toBe("native");
  });

  it("supports the legacy nativeCompaction flag", () => {
    expect(resolveWorkspaceCompactionBackend({ nativeCompaction: true })).toBe("native");
    expect(resolveWorkspaceCompactionBackend({ nativeCompaction: false })).toBe("summary");
  });
});

describe("resolveWorkspaceContextManagementToolsEnabled", () => {
  it("defaults to true when unset", () => {
    expect(resolveWorkspaceContextManagementToolsEnabled(undefined)).toBe(true);
    expect(resolveWorkspaceContextManagementToolsEnabled({})).toBe(true);
  });

  it("returns false when explicitly disabled", () => {
    expect(resolveWorkspaceContextManagementToolsEnabled({ contextManagementToolsEnabled: false })).toBe(false);
  });

  it("returns true when explicitly enabled", () => {
    expect(resolveWorkspaceContextManagementToolsEnabled({ contextManagementToolsEnabled: true })).toBe(true);
  });
});
