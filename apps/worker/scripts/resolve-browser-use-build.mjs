import fs from "node:fs";
import path from "node:path";

const OUTPUT_PATH = process.env.MEOWBERT_BROWSER_USE_BUILD_INFO_PATH || "/tmp/browser-use-build.json";
const CONFIG_ROOT = process.env.MEOWBERT_BROWSER_USE_CONFIG_ROOT || "/tmp/build-config";

function parseBoolean(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }

  throw new Error(
    `Unsupported MEOWBERT_BROWSER_USE_ENABLED value "${value}". Use true/false, 1/0, yes/no, on/off, or leave it unset.`
  );
}

function readEnabledFromConfig(configPath) {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const browserUseEnabled = raw?.skills?.browserUse?.enabled !== false;
  const htmlCanvasEnabled = raw?.skills?.htmlCanvas?.enabled === true;
  return {
    browserUseEnabled,
    htmlCanvasEnabled,
    playwrightBrowsersEnabled: browserUseEnabled || htmlCanvasEnabled,
    source: configPath
  };
}

function resolveFromConfigFiles() {
  const candidates = [
    "global.docker.json",
    "global.json",
    "global.example.json"
  ].map((filename) => path.join(CONFIG_ROOT, filename));

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    return readEnabledFromConfig(candidate);
  }

  return {
    browserUseEnabled: true,
    htmlCanvasEnabled: false,
    playwrightBrowsersEnabled: true,
    source: "default"
  };
}

const browserUseOverride = parseBoolean(process.env.MEOWBERT_BROWSER_USE_ENABLED);
const htmlCanvasOverride = parseBoolean(process.env.MEOWBERT_HTML_CANVAS_ENABLED);
const configResolved = resolveFromConfigFiles();
const resolved = browserUseOverride === null && htmlCanvasOverride === null
  ? configResolved
  : {
      browserUseEnabled: browserUseOverride ?? configResolved.browserUseEnabled,
      htmlCanvasEnabled: htmlCanvasOverride ?? configResolved.htmlCanvasEnabled,
      playwrightBrowsersEnabled: (browserUseOverride ?? configResolved.browserUseEnabled)
        || (htmlCanvasOverride ?? configResolved.htmlCanvasEnabled),
      source: [
        browserUseOverride !== null ? "MEOWBERT_BROWSER_USE_ENABLED" : null,
        htmlCanvasOverride !== null ? "MEOWBERT_HTML_CANVAS_ENABLED" : null
      ].filter(Boolean).join(", ")
    };

fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
  browserUseEnabled: resolved.browserUseEnabled,
  htmlCanvasEnabled: resolved.htmlCanvasEnabled,
  playwrightBrowsersEnabled: resolved.playwrightBrowsersEnabled,
  source: resolved.source
}, null, 2));

console.log(
  `[browser-use-build] ${resolved.playwrightBrowsersEnabled ? "enabled" : "disabled"} via ${resolved.source}`
);
