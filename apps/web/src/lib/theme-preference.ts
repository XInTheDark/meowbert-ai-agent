import { normalizeThemeMode } from "@meowbert/shared/themes";
import type { ThemeMode } from "./types";

export const THEME_KEY = "meowbert_theme";

export function readStoredTheme(): ThemeMode | undefined {
  try {
    return normalizeThemeMode(localStorage.getItem(THEME_KEY));
  } catch {
    return undefined;
  }
}

export function themeAtBoot(): ThemeMode {
  return readStoredTheme() ?? "dark";
}
