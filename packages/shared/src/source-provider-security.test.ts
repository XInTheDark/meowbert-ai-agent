import { describe, expect, it } from "vitest";
import {
  assertSourceProviderRuntimeEnabled,
  isSourceProviderRuntimeEnabled,
  RCLONE_SOURCE_DISABLED_MESSAGE
} from "./source-provider-security.js";

describe("source provider runtime availability", () => {
  it("keeps rclone disabled at runtime", () => {
    expect(isSourceProviderRuntimeEnabled("rclone")).toBe(false);
    expect(() => assertSourceProviderRuntimeEnabled("rclone")).toThrow(RCLONE_SOURCE_DISABLED_MESSAGE);
  });

  it("keeps other source providers available", () => {
    expect(isSourceProviderRuntimeEnabled("google-drive")).toBe(true);
    expect(() => assertSourceProviderRuntimeEnabled("google-drive")).not.toThrow();
  });
});
