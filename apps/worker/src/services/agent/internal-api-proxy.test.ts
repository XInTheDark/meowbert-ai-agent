import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config.js", () => ({
  config: {
    security: { jwtSecret: "test-internal-proxy-secret" },
    server: {
      internalUrl: "http://api.internal:3001",
      publicUrl: "http://localhost:3001"
    }
  }
}));
import { signInternalScopedAccessTicket } from "./internal-api-proxy.js";

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
}

describe("signInternalScopedAccessTicket", () => {
  it("issues long-lived source proxy tickets for MCP source sessions", () => {
    const token = signInternalScopedAccessTicket({
      scope: "source_proxy",
      userId: "user-1",
      taskId: "task-1",
      workspaceId: "workspace-1",
      sourceId: "outlook"
    });

    const payload = decodeJwtPayload(token);
    expect(payload.scope).toBe("source_proxy");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect((payload.exp as number) - (payload.iat as number)).toBeGreaterThanOrEqual(8 * 60 * 60);
  });

  it("issues reference-only tickets for source-dependent skills", () => {
    const token = signInternalScopedAccessTicket({
      scope: "source_reference_proxy",
      userId: "user-1",
      taskId: "task-1",
      workspaceId: "workspace-1",
      sourceId: "google-drive"
    });
    const [, encodedPayload] = token.split(".");
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    expect(payload.scope).toBe("source_reference_proxy");
  });
});
