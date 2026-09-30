import { describe, expect, it, vi } from "vitest";

vi.mock("./internal-api-proxy.js", () => ({
  resolveInternalApiBaseUrl: vi.fn(() => "http://api.internal"),
  signInternalScopedAccessTicket: vi.fn(() => "ticket")
}));

import { buildSourceRuntimeEnv } from "./source-runtime.js";

const commonInput = {
  userId: "user-1",
  taskId: "task-1",
  taskDir: "/task",
  workspaceId: "workspace-1",
  workspaceRoot: "/workspace",
  sourceId: "source-1"
};

describe("buildSourceRuntimeEnv", () => {
  it("rejects saved rclone sources before minting worker runtime access", () => {
    expect(() => buildSourceRuntimeEnv({
      ...commonInput,
      provider: "rclone"
    })).toThrow("temporarily disabled");
  });

  it("keeps enabled source providers available", () => {
    expect(buildSourceRuntimeEnv({
      ...commonInput,
      provider: "google-drive"
    })).toMatchObject({
      SOURCE_ID: "source-1",
      SOURCE_PROVIDER: "google-drive"
    });
  });
});
