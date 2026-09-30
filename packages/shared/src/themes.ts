export const THEME_MODE_VALUES = [
  "system",
  "light",
  "dark",
  "github-light",
  "github-dark",
  "dracula",
  "nord",
  "nord-light",
  "solarized-light",
  "solarized-dark",
  "tokyo-day",
  "tokyo-night",
  "catppuccin-latte",
  "catppuccin-mocha",
  "gpt",
  "google-classic",
  "google-dark",
  "trash",
  "viber",
  "openai-pride",
  "usa",
  "index-light",
  "index-dark",
  "tide-light",
  "tide-dark",
  "signal-light",
  "signal-dark"
] as const;

export type ThemeMode = (typeof THEME_MODE_VALUES)[number];

/** Canonical replacements for saved preferences from the retired Original collection. */
export const LEGACY_THEME_MODES: Readonly<Record<string, ThemeMode>> = {
  "aurora-light": "signal-light",
  "alpine-frost": "signal-light",
  "blueprint-light": "signal-light",
  "graphite": "signal-light",
  "aurora": "signal-dark",
  "alpine-night": "signal-dark",
  "blueprint": "signal-dark",
  "graphite-dark": "signal-dark",
  "sunset-light": "index-light",
  "rose-dawn": "index-light",
  "linen": "index-light",
  "copper-slate-light": "index-light",
  "sunset": "index-dark",
  "rose-dusk": "index-dark",
  "ember-noir": "index-dark",
  "linen-dark": "index-dark",
  "copper-slate": "index-dark",
  "moonlit-garden-light": "tide-light",
  "jade-paper": "tide-light",
  "moss-studio": "tide-light",
  "moonlit-garden": "tide-dark",
  "jade-night": "tide-dark",
  "moss-studio-dark": "tide-dark"
};

const themeModes = new Set<string>(THEME_MODE_VALUES);

export function normalizeThemeMode(value: unknown): ThemeMode | undefined {
  if (typeof value !== "string") return undefined;
  if (themeModes.has(value)) return value as ThemeMode;
  return Object.hasOwn(LEGACY_THEME_MODES, value) ? LEGACY_THEME_MODES[value] : undefined;
}
