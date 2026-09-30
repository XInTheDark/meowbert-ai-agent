import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const BUILD_INFO_PATH = process.env.MEOWBERT_BROWSER_USE_BUILD_INFO_PATH || "/app/build-meta/browser-use.json";
const BROWSER_ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || "/ms-playwright";
const BROWSER_CHANNEL = process.env.MEOWBERT_BROWSER_USE_BROWSER || "chromium";
const require = createRequire(import.meta.url);

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
    `Unsupported browser-use toggle value "${value}". Use true/false, 1/0, yes/no, on/off, or leave it unset.`
  );
}

function resolveConfigPath() {
  if (process.env.MEOWBERT_CONFIG_PATH) {
    return process.env.MEOWBERT_CONFIG_PATH;
  }

  const candidates = [
    path.resolve(process.cwd(), "config/global.json"),
    path.resolve(process.cwd(), "config/global.docker.json"),
    path.resolve(process.cwd(), "../config/global.json"),
    path.resolve(process.cwd(), "../config/global.docker.json"),
    path.resolve(process.cwd(), "../../config/global.json"),
    path.resolve(process.cwd(), "../../config/global.docker.json")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveRuntimeEnabled() {
  const inlineConfig = process.env.MEOWBERT_CONFIG_JSON;
  if (inlineConfig) {
    const parsed = JSON.parse(inlineConfig);
    return parsed?.skills?.browserUse?.enabled !== false;
  }

  const inlineConfigBase64 = process.env.MEOWBERT_CONFIG_BASE64;
  if (inlineConfigBase64) {
    const raw = Buffer.from(inlineConfigBase64, "base64").toString("utf-8");
    const parsed = JSON.parse(raw);
    return parsed?.skills?.browserUse?.enabled !== false;
  }

  const explicitOverride = parseBoolean(process.env.MEOWBERT_BROWSER_USE_ENABLED);
  if (explicitOverride !== null) {
    return explicitOverride;
  }

  const configPath = resolveConfigPath();
  if (!configPath) {
    return true;
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return parsed?.skills?.browserUse?.enabled !== false;
}

function resolveBundledBrowserExecutablePath(browserChannel) {
  try {
    const { registry } = require("playwright-core/lib/server/registry/index");
    const executable = registry.findExecutable(browserChannel);
    return executable?.executablePath?.() ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to inspect Playwright browser registry for ${browserChannel}: ${message}`);
  }
}

const runtimeEnabled = resolveRuntimeEnabled();
const buildInfo = fs.existsSync(BUILD_INFO_PATH)
  ? JSON.parse(fs.readFileSync(BUILD_INFO_PATH, "utf-8"))
  : { browserUseEnabled: false, source: "missing-build-info" };
const buildEnabled = buildInfo?.playwrightBrowsersEnabled === true || buildInfo?.browserUseEnabled === true;
const browserFilesPresent = fs.existsSync(BROWSER_ROOT);
const browserExecutablePath = buildEnabled ? resolveBundledBrowserExecutablePath(BROWSER_CHANNEL) : null;
const browserExecutablePresent = browserExecutablePath !== null && fs.existsSync(browserExecutablePath);

if (runtimeEnabled && (!buildEnabled || !browserFilesPresent || !browserExecutablePresent)) {
  const reason = !buildEnabled
    ? `worker image was built with browser-use disabled (${buildInfo.source ?? "unknown"})`
    : !browserFilesPresent
      ? `browser files are missing at ${BROWSER_ROOT}`
      : `Playwright ${BROWSER_CHANNEL} is not installed${browserExecutablePath ? ` (expected ${browserExecutablePath})` : ""}`;
  console.error(
    `[entrypoint] Browser Use is enabled in server config but ${reason}. Rebuild the worker image after updating config.`
  );
  process.exit(1);
}

if (!runtimeEnabled && buildEnabled) {
  console.warn(
    `[entrypoint] Browser Use is disabled in server config, but this image still includes bundled browser assets from ${buildInfo.source ?? "unknown"}. Rebuild the worker image to remove them.`
  );
}
