import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isThemeDark, isThemeMode, resolveTheme, THEME_OPTIONS } from "./theme";
import { THEME_MODE_VALUES } from "./types";

describe("theme helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("validates supported theme ids", () => {
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("github-dark")).toBe(true);
    expect(isThemeMode("nord-light")).toBe(true);
    expect(isThemeMode("usa")).toBe(true);
    expect(isThemeMode("openai-pride")).toBe(true);
    expect(isThemeMode("google-classic")).toBe(true);
    expect(isThemeMode("google-dark")).toBe(true);
    expect(isThemeMode("gpt")).toBe(true);
    expect(isThemeMode("trash")).toBe(true);
    expect(isThemeMode("viber")).toBe(true);
    expect(isThemeMode("index-light")).toBe(true);
    expect(isThemeMode("index-dark")).toBe(true);
    expect(isThemeMode("tide-dark")).toBe(true);
    expect(isThemeMode("signal-light")).toBe(true);
    expect(isThemeMode("linen")).toBe(false);
    expect(isThemeMode("amethyst-haze")).toBe(false);
    expect(isThemeMode("velvet-emerald")).toBe(false);
    expect(isThemeMode("midnight")).toBe(false);
  });

  it("keeps requested themes in the right groups", () => {
    expect(THEME_OPTIONS.find((option) => option.id === "usa")).toMatchObject({ group: "Special", label: "USA" });
    expect(THEME_OPTIONS.find((option) => option.id === "openai-pride")).toMatchObject({
      group: "Special",
      label: "OpenAI Pride"
    });
    expect(THEME_OPTIONS.find((option) => option.id === "google-classic")).toMatchObject({
      group: "Special",
      label: "Google",
      familyId: "google",
      mode: "light"
    });
    expect(THEME_OPTIONS.find((option) => option.id === "google-dark")).toMatchObject({
      group: "Special",
      label: "Google Dark",
      familyId: "google",
      mode: "dark"
    });
    expect(THEME_OPTIONS.find((option) => option.id === "gpt")).toMatchObject({
      group: "Special",
      label: "GPT"
    });
    expect(THEME_OPTIONS.find((option) => option.id === "trash")).toMatchObject({
      group: "Special",
      label: "Trash"
    });
    expect(THEME_OPTIONS.find((option) => option.id === "viber")).toMatchObject({
      group: "Special",
      label: "Viber",
      mode: "dark"
    });
    expect(THEME_OPTIONS.filter((option) => option.group === "Original").map((option) => option.id)).toEqual([
      "index-light", "index-dark", "tide-light", "tide-dark", "signal-light", "signal-dark"
    ]);
  });

  it("keeps special themes in the requested order", () => {
    expect(THEME_OPTIONS.filter((option) => option.group === "Special").map((option) => option.id)).toEqual([
      "gpt",
      "google-classic",
      "google-dark",
      "trash",
      "viber",
      "openai-pride",
      "usa"
    ]);
  });

  it("marks paired themes with shared picker families", () => {
    const pairedFamilies = [
      "github",
      "nord",
      "solarized",
      "tokyo",
      "catppuccin",
      "google",
      "index",
      "tide",
      "signal"
    ];

    for (const familyId of pairedFamilies) {
      expect(THEME_OPTIONS.filter((option) => option.familyId === familyId).map((option) => option.mode).sort()).toEqual(["dark", "light"]);
    }
  });

  it("gives every theme a selector preview and description", () => {
    for (const option of THEME_OPTIONS) {
      expect(option.description.length).toBeGreaterThan(0);
      expect(option.preview).toHaveLength(3);
    }
  });

  it("keeps theme options aligned with supported theme ids", () => {
    expect(THEME_OPTIONS.map((option) => option.id).sort()).toEqual([...THEME_MODE_VALUES].sort());
  });

  it("returns non-system themes directly", () => {
    expect(resolveTheme("dracula")).toBe("dracula");
  });

  it("resolves system theme based on OS preference", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("dark"),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    }));

    expect(resolveTheme("system")).toBe("dark");
  });

  it("drops all styling for retired novelty themes", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).not.toContain('data-theme="aero"');
    expect(styles).not.toContain('data-theme="counter-strike-mirage"');
    expect(styles).not.toContain('data-theme="counter-strike-nuke"');
    expect(styles).not.toContain("@keyframes aero-");
    expect(styles).not.toContain("@keyframes mirage-");
    expect(styles).not.toContain("@keyframes nuke-");
  });

  it("classifies every explicit theme, including standalone dark themes", () => {
    for (const option of THEME_OPTIONS.filter((option) => option.id !== "system")) {
      expect(["light", "dark"]).toContain(option.mode);
      expect(isThemeDark(option.id)).toBe(option.mode === "dark");
    }
    expect(isThemeDark("gpt")).toBe(true);
    expect(isThemeDark("trash")).toBe(true);
    expect(isThemeDark("google-classic")).toBe(false);
  });

  it("falls back to dark without device preference support", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("matchMedia", undefined);
    expect(resolveTheme("system")).toBe("dark");
  });
});
