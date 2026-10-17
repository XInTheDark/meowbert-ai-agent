import { useEffect, useState } from "react";
import type { CanvasFrameTheme } from "@meowbert/shared/canvas-frame";
import { isThemeDark } from "../../lib/theme";

// App variables a canvas page can use as `--mb-<token>`.
const TOKEN_VARIABLES: Record<string, string> = {
  bg: "--bg",
  surface: "--surface",
  "surface-soft": "--surface-soft",
  text: "--text",
  muted: "--text-muted",
  border: "--border",
  accent: "--brand",
  font: "--font-ui"
};

export function readCanvasTheme(): CanvasFrameTheme {
  if (typeof document === "undefined") return { mode: "light", tokens: {} };
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const [token, variable] of Object.entries(TOKEN_VARIABLES)) {
    const value = styles.getPropertyValue(variable).trim();
    if (value) tokens[token] = value;
  }
  return { mode: isThemeDark(root.getAttribute("data-theme") ?? "") ? "dark" : "light", tokens };
}

/** The current app theme as canvas tokens, updated when the user switches themes. */
export function useCanvasTheme(): CanvasFrameTheme {
  const [theme, setTheme] = useState(readCanvasTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readCanvasTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
