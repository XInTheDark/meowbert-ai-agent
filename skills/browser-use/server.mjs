import fs from "node:fs";
import { spawn } from "node:child_process";
import { ensurePlaywrightBrowserInstalled } from "../shared/playwright-browser-utils.mjs";
import { resolveTaskPathBaseDir } from "../shared/task-path-utils.mjs";

function relaySignal(child, signal) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

async function main() {
  const taskDir = resolveTaskPathBaseDir();
  fs.mkdirSync(taskDir, { recursive: true });

  const browserName = process.env.PLAYWRIGHT_MCP_BROWSER || "chromium";
  const runtime = ensurePlaywrightBrowserInstalled(browserName);
  const child = spawn(
    process.execPath,
    [
      "/app/node_modules/@playwright/mcp/cli.js",
      "--browser",
      browserName,
      "--executable-path",
      runtime.executablePath,
      "--headless",
      "--isolated",
      "--no-sandbox",
      "--output-dir",
      taskDir
    ],
    {
      cwd: taskDir,
      stdio: "inherit",
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: runtime.browserRoot,
        PLAYWRIGHT_MCP_OUTPUT_DIR: taskDir
      }
    }
  );

  relaySignal(child, "SIGINT");
  relaySignal(child, "SIGTERM");

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
