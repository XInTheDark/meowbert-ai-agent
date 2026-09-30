import { THEME_MODE_VALUES, ThemeMode } from "./types";
export { normalizeThemeMode } from "@meowbert/shared/themes";

export interface ThemeOption {
  id: ThemeMode;
  label: string;
  group: "System" | "Popular" | "Special" | "Original";
  description: string;
  preview: string[];
  familyId?: string;
  familyLabel?: string;
  familyDescription?: string;
  mode: "system" | "light" | "dark";
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "system", label: "System", group: "System", description: "Follow this device.", preview: ["#f5f7fb", "#060912", "#74a7ff"], mode: "system" },
  { id: "light", label: "Light", group: "Popular", description: "Clean default light mode.", preview: ["#f6f6f5", "#ffffff", "#315f9f"], familyId: "default", familyLabel: "Default", familyDescription: "Clean Meowbert UI.", mode: "light" },
  { id: "dark", label: "Dark", group: "Popular", description: "Clean default dark mode.", preview: ["#171819", "#202224", "#91b4ef"], familyId: "default", familyLabel: "Default", familyDescription: "Clean Meowbert UI.", mode: "dark" },
  { id: "github-light", label: "GitHub Light", group: "Popular", description: "GitHub-style light UI.", preview: ["#f6f8fa", "#ffffff", "#0969da"], familyId: "github", familyLabel: "GitHub", familyDescription: "GitHub-style workspace.", mode: "light" },
  { id: "github-dark", label: "GitHub Dark", group: "Popular", description: "GitHub-style dark UI.", preview: ["#0d1117", "#161b22", "#58a6ff"], familyId: "github", familyLabel: "GitHub", familyDescription: "GitHub-style workspace.", mode: "dark" },
  { id: "dracula", label: "Dracula", group: "Popular", description: "Purple terminal palette.", preview: ["#1e1f29", "#282a36", "#bd93f9"], mode: "dark" },
  { id: "nord-light", label: "Nord Light", group: "Popular", description: "Cool low-contrast light blue.", preview: ["#eceff4", "#ffffff", "#5e81ac"], familyId: "nord", familyLabel: "Nord", familyDescription: "Cool low-contrast blue.", mode: "light" },
  { id: "nord", label: "Nord Dark", group: "Popular", description: "Cool low-contrast blue.", preview: ["#2e3440", "#3b4252", "#88c0d0"], familyId: "nord", familyLabel: "Nord", familyDescription: "Cool low-contrast blue.", mode: "dark" },
  { id: "solarized-light", label: "Solarized Light", group: "Popular", description: "Warm low-glare classic.", preview: ["#fdf6e3", "#fffaf0", "#268bd2"], familyId: "solarized", familyLabel: "Solarized", familyDescription: "Low-glare terminal classic.", mode: "light" },
  { id: "solarized-dark", label: "Solarized Dark", group: "Popular", description: "Deep teal terminal classic.", preview: ["#002b36", "#073642", "#268bd2"], familyId: "solarized", familyLabel: "Solarized", familyDescription: "Low-glare terminal classic.", mode: "dark" },
  { id: "tokyo-day", label: "Tokyo Day", group: "Popular", description: "Bright editor palette.", preview: ["#f3f4f8", "#ffffff", "#34548a"], familyId: "tokyo", familyLabel: "Tokyo", familyDescription: "Clean editor palette.", mode: "light" },
  { id: "tokyo-night", label: "Tokyo Night", group: "Popular", description: "Night editor palette.", preview: ["#1a1b26", "#24283b", "#7aa2f7"], familyId: "tokyo", familyLabel: "Tokyo", familyDescription: "Clean editor palette.", mode: "dark" },
  { id: "catppuccin-latte", label: "Catppuccin Latte", group: "Popular", description: "Soft pastel light mode.", preview: ["#eff1f5", "#ffffff", "#1e66f5"], familyId: "catppuccin", familyLabel: "Catppuccin", familyDescription: "Soft pastel workspace.", mode: "light" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", group: "Popular", description: "Soft pastel dark mode.", preview: ["#11111b", "#1e1e2e", "#89b4fa"], familyId: "catppuccin", familyLabel: "Catppuccin", familyDescription: "Soft pastel workspace.", mode: "dark" },
  { id: "gpt", label: "GPT", group: "Special", description: "ChatGPT-inspired neutral dark.", preview: ["#202123", "#303030", "#10a37f"], mode: "dark" },
  { id: "google-classic", label: "Google", group: "Special", description: "Google Workspace-style light UI.", preview: ["#f8fafd", "#1a73e8", "#34a853"], familyId: "google", familyLabel: "Google", familyDescription: "Google Workspace-style UI.", mode: "light" },
  { id: "google-dark", label: "Google Dark", group: "Special", description: "Google Workspace-style dark UI.", preview: ["#131314", "#1f1f1f", "#8ab4f8"], familyId: "google", familyLabel: "Google", familyDescription: "Google Workspace-style UI.", mode: "dark" },
  { id: "trash", label: "Trash", group: "Special", description: "Claude-inspired warm dark.", preview: ["#191816", "#2d2c29", "#d97757"], mode: "dark" },
  { id: "viber", label: "Viber", group: "Special", description: "Codex-inspired editor dark.", preview: ["#1f1f1f", "#59c2c5", "#8df8fc"], mode: "dark" },
  { id: "openai-pride", label: "OpenAI Pride", group: "Special", description: "Bright rainbow accent set.", preview: ["#0c0f14", "#ff4fd8", "#5bd4ff"], mode: "dark" },
  { id: "usa", label: "USA", group: "Special", description: "High-contrast civic colors.", preview: ["#101b33", "#16274a", "#cf2e2e"], mode: "dark" },
  { id: "index-light", label: "Index Light", group: "Original", description: "Paper, ink, and vermilion.", preview: ["#f4f0e7", "#fffdf7", "#ae3828"], familyId: "index", familyLabel: "Index", familyDescription: "Paper, ink, and vermilion.", mode: "light" },
  { id: "index-dark", label: "Index Dark", group: "Original", description: "Paper, ink, and vermilion.", preview: ["#1c1b19", "#252420", "#ed927c"], familyId: "index", familyLabel: "Index", familyDescription: "Paper, ink, and vermilion.", mode: "dark" },
  { id: "tide-light", label: "Tide Light", group: "Original", description: "Sea glass and deep petrol.", preview: ["#edf5f2", "#fafffd", "#176b60"], familyId: "tide", familyLabel: "Tide", familyDescription: "Sea glass and deep petrol.", mode: "light" },
  { id: "tide-dark", label: "Tide Dark", group: "Original", description: "Sea glass and deep petrol.", preview: ["#10282c", "#19363a", "#80d7bd"], familyId: "tide", familyLabel: "Tide", familyDescription: "Sea glass and deep petrol.", mode: "dark" },
  { id: "signal-light", label: "Signal Light", group: "Original", description: "Sharp neutrals and yellow.", preview: ["#f5f5f1", "#ffffff", "#756000"], familyId: "signal", familyLabel: "Signal", familyDescription: "Sharp neutrals and yellow.", mode: "light" },
  { id: "signal-dark", label: "Signal Dark", group: "Original", description: "Sharp neutrals and yellow.", preview: ["#171717", "#242424", "#f1d45b"], familyId: "signal", familyLabel: "Signal", familyDescription: "Sharp neutrals and yellow.", mode: "dark" },
];

const supportedThemeSet = new Set<string>(THEME_MODE_VALUES);

const themeDarkLookup = new Map<string, boolean>(
  THEME_OPTIONS.map((option) => [option.id, option.mode === "dark"])
);

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && supportedThemeSet.has(value);
}

export function isThemeDark(themeId: string): boolean {
  return themeDarkLookup.get(themeId) ?? true;
}

function detectSystemTheme(): "light" | "dark" {
  const matchMedia =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia.bind(window)
      : typeof globalThis.matchMedia === "function"
        ? globalThis.matchMedia.bind(globalThis)
        : null;

  if (!matchMedia) {
    return "dark";
  }

  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(mode: ThemeMode): Exclude<ThemeMode, "system"> {
  if (mode === "system") {
    return detectSystemTheme();
  }
  return mode;
}
