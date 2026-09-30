import { resolveTheme } from "./lib/theme";
import { themeAtBoot } from "./lib/theme-preference";

// Apply the saved palette before React mounts, including retired theme preferences.
document.documentElement.dataset.theme = resolveTheme(themeAtBoot());
