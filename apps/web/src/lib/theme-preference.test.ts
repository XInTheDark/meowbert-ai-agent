import { afterEach, describe, expect, it, vi } from "vitest";
import { readStoredTheme, themeAtBoot } from "./theme-preference";

afterEach(() => vi.unstubAllGlobals());

describe("theme boot preference", () => {
  it.each([[null, "dark"], ["light", "light"], ["system", "system"], ["linen", "index-light"], ["moonlit-garden", "tide-dark"], ["unknown", "dark"]])(
    "resolves %s to %s", (stored, expected) => {
      vi.stubGlobal("localStorage", { getItem: () => stored });
      expect(themeAtBoot()).toBe(expected);
    }
  );

  it("uses Dark when browser storage is blocked without claiming an explicit preference", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Blocked storage"); } });
    expect(themeAtBoot()).toBe("dark");
    expect(readStoredTheme()).toBeUndefined();
  });
});
