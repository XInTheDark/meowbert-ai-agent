import { expect, it } from "vitest";
import { isSupportedLocalExecutor } from "@meowbert/shared";
import { sandboxArchitecture } from "./platform";

it.each([["darwin", "arm64", true], ["win32", "x64", true], ["win32", "arm64", true], ["linux", "x64", false], ["darwin", "x64", false]])(
  "enforces supported executor platforms %s/%s", (platform, arch, supported) => {
    expect(isSupportedLocalExecutor(String(platform), String(arch))).toBe(supported);
  }
);
it("chooses native Linux image builds", () => {
  expect(sandboxArchitecture("x64")).toBe("amd64");
  expect(sandboxArchitecture("arm64")).toBe("arm64");
});
