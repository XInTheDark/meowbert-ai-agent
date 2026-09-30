import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGACY_THEME_MODES, normalizeThemeMode, THEME_MODE_VALUES } from "./themes.js";

describe("theme preference migration", () => {
  it("preserves explicit supported choices including System and Light", () => {
    for (const theme of THEME_MODE_VALUES) expect(normalizeThemeMode(theme)).toBe(theme);
  });

  it("maps retired originals without changing their light or dark mode", () => {
    expect(normalizeThemeMode("linen")).toBe("index-light");
    expect(normalizeThemeMode("ember-noir")).toBe("index-dark");
    expect(normalizeThemeMode("moss-studio")).toBe("tide-light");
    expect(normalizeThemeMode("moonlit-garden")).toBe("tide-dark");
    expect(normalizeThemeMode("graphite")).toBe("signal-light");
    expect(normalizeThemeMode("blueprint")).toBe("signal-dark");
    for (const replacement of Object.values(LEGACY_THEME_MODES)) {
      expect(THEME_MODE_VALUES).toContain(replacement);
    }
  });

  it("keeps the database migration aligned with canonical preferences and legacy mappings", () => {
    const migration = readFileSync(new URL("../../../db/migrations/119_refresh_theme_preferences.sql", import.meta.url), "utf8");
    const check = migration.slice(migration.indexOf("CHECK (theme_preference IN"));
    const databaseThemes = [...check.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(databaseThemes.sort()).toEqual([...THEME_MODE_VALUES].sort());
    for (const [oldTheme, newTheme] of Object.entries(LEGACY_THEME_MODES)) {
      expect(migration).toContain(`WHEN '${oldTheme}' THEN '${newTheme}'`);
    }
    expect(migration).toContain("SET DEFAULT 'dark'");
  });

  it("rejects unknown values and inherited object properties", () => {
    for (const value of [null, undefined, {}, "", "toString", "__proto__", "unknown"]) {
      expect(normalizeThemeMode(value)).toBeUndefined();
    }
  });
});
