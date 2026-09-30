import fs from "node:fs";
import { createRequire } from "node:module";

const DEFAULT_BROWSER_NAME = "chromium";
const DEFAULT_BROWSER_ROOT = "/ms-playwright";
const require = createRequire(import.meta.url);

function resolveRegistry() {
  try {
    return require("playwright-core/lib/server/registry/index").registry;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load Playwright browser registry: ${message}`);
  }
}

export function ensurePlaywrightBrowsersPath() {
  const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || DEFAULT_BROWSER_ROOT;
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
  return browserRoot;
}

export function resolvePlaywrightBrowserExecutable(browserName = DEFAULT_BROWSER_NAME) {
  const registry = resolveRegistry();
  const executable = registry.findExecutable(browserName);
  return executable?.executablePath?.() ?? null;
}

export function ensurePlaywrightBrowserInstalled(browserName = DEFAULT_BROWSER_NAME) {
  const browserRoot = ensurePlaywrightBrowsersPath();
  const executablePath = resolvePlaywrightBrowserExecutable(browserName);

  if (!executablePath || !fs.existsSync(executablePath)) {
    const installCommand = "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright ./node_modules/.bin/playwright install chromium";
    throw new Error(
      `Bundled Playwright ${browserName} is not installed. Expected a browser under ${browserRoot}. Rebuild the sandbox runtime image and ensure it runs: ${installCommand}`
    );
  }

  return {
    browserName,
    browserRoot,
    executablePath
  };
}
