import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { isWithinPath } from "../../packages/shared/src/path-containment.mjs";
import {
  CANVAS_FRAME_NAME_PREFIX,
  CANVAS_FRAME_SANDBOX,
  injectCanvasFrameRuntime
} from "../../packages/shared/src/canvas-frame-runtime.mjs";
import { ensurePlaywrightBrowserInstalled } from "./playwright-browser-utils.mjs";

// Loads a canvas the way the app shows it: served over HTTP with the same sandbox policy and
// injected runtime, inside a sandboxed iframe, so storage, forms and paths fail here exactly
// when they would fail for the user.

const FRAME_PREFIX = "/frame/";
const SETTLE_MS = 1500;
const MAX_SCREENSHOT_HEIGHT = 2400;
const DISPLAY_VIEWPORTS = {
  inline: { width: 800, height: 900, frameHeight: 360, autoHeight: true },
  panel: { width: 1280, height: 800, frameHeight: 800, autoHeight: false }
};
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function buildHarnessHtml({ entryUrl, frameHeight, autoHeight, theme }) {
  const frameName = `${CANVAS_FRAME_NAME_PREFIX}${JSON.stringify({ theme, storage: {} })}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: ${theme.mode === "dark" ? "#16161a" : "#ffffff"}; }
iframe { display: block; width: 100%; height: ${frameHeight}px; border: 0; background: #ffffff; }
</style></head><body><script>
window.__canvasCheck = { messages: [] };
const frame = document.createElement("iframe");
frame.setAttribute("sandbox", ${JSON.stringify(CANVAS_FRAME_SANDBOX)});
frame.name = ${JSON.stringify(frameName).replace(/</g, "\\u003c")};
window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || !event.data || event.data.source !== "meowbert-canvas") return;
  window.__canvasCheck.messages.push(event.data);
  if (event.data.type === "resize" && ${autoHeight}) {
    frame.style.height = Math.max(120, Math.min(${MAX_SCREENSHOT_HEIGHT}, event.data.height)) + "px";
  }
});
frame.src = ${JSON.stringify(entryUrl)};
document.body.appendChild(frame);
</script></body></html>`;
}

async function serveFrameFile(rootDir, requestPath, response) {
  const relativePath = decodeURIComponent(requestPath.slice(FRAME_PREFIX.length));
  const absolutePath = path.resolve(rootDir, relativePath);
  const stat = isWithinPath(rootDir, absolutePath) ? await fs.stat(absolutePath).catch(() => null) : null;
  if (!stat?.isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
    return;
  }

  const contentType = CONTENT_TYPES[path.extname(absolutePath).toLowerCase()] ?? "application/octet-stream";
  const headers = {
    "Content-Type": contentType,
    "Content-Security-Policy": `sandbox ${CANVAS_FRAME_SANDBOX}`,
    "Cache-Control": "no-store"
  };
  // The app's API answers cross-origin module and fetch requests from the opaque frame origin.
  headers["Access-Control-Allow-Origin"] = "*";
  if (contentType.startsWith("text/html")) {
    response.writeHead(200, headers);
    response.end(injectCanvasFrameRuntime(await fs.readFile(absolutePath, "utf8")));
    return;
  }
  response.writeHead(200, headers);
  response.end(await fs.readFile(absolutePath));
}

function startCanvasServer({ rootDir, harnessHtml }) {
  const server = http.createServer((request, response) => {
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    if (requestPath === "/__harness") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(harnessHtml());
      return;
    }
    if (requestPath.startsWith(FRAME_PREFIX)) {
      serveFrameFile(rootDir, requestPath, response).catch((error) => {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function toFramePath(url, origin) {
  if (!url) return url;
  if (url.startsWith(`${origin}${FRAME_PREFIX}`)) return decodeURIComponent(url.slice(origin.length + FRAME_PREFIX.length));
  if (url.startsWith(origin)) return url.slice(origin.length);
  return url;
}

function summarizeMessages(messages, origin) {
  const ready = messages.find((message) => message.type === "ready") ?? null;
  const contentStates = messages.filter((message) => message.type === "ready" || message.type === "content");
  const lastContent = contentStates.at(-1) ?? null;
  const lastResize = messages.filter((message) => message.type === "resize").at(-1) ?? null;
  const seen = new Set();
  const errors = [];
  for (const message of messages) {
    if (message.type !== "error" || !message.error) continue;
    const error = {
      kind: message.error.kind,
      message: message.error.message,
      source: toFramePath(message.error.source, origin),
      line: message.error.line ?? null
    };
    const key = `${error.kind}|${error.message}|${error.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push(error);
  }
  return {
    runtimeStarted: messages.some((message) => message.type === "hello"),
    ready: ready !== null,
    blank: lastContent ? lastContent.blank === true : true,
    title: ready?.title ?? null,
    contentHeight: lastResize?.height ?? null,
    errors
  };
}

function buildHints({ summary, failedRequests }) {
  const hints = [];
  if (failedRequests.some((request) => !request.url.startsWith("http") && request.url.startsWith("/"))) {
    hints.push("A root-absolute URL (starting with /) points outside the canvas. Use relative paths such as ./style.css; for framework builds set the base to ./ (for example `vite build --base ./`).");
  }
  if (failedRequests.some((request) => /^https?:/.test(request.url))) {
    hints.push("External requests failed in the check. If the sandbox has no network that is expected, but the page then depends on a CDN; prefer bundling dependencies beside the page.");
  }
  if (!summary.runtimeStarted) {
    hints.push("The page did not load as HTML. Check the path and that the file exists.");
  } else if (!summary.ready) {
    hints.push("The page never finished loading. A script may be blocking or a resource never responded.");
  } else if (summary.blank) {
    hints.push("The page loaded but nothing visible rendered. Check the errors, and that the app mounts into the page.");
  }
  return hints;
}

async function waitForSettledFrame(page, timeoutMs) {
  await page.waitForFunction(
    () => window.__canvasCheck.messages.some((message) => message.type === "ready"),
    null,
    { timeout: timeoutMs }
  ).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Loads an HTML canvas in Chromium under the app's frame conditions and reports what broke.
 * @param {{ inputPath: string, rootDir: string, display?: "inline" | "panel", theme?: "light" | "dark", screenshotPath: string, viewportWidth?: number | null, timeoutMs?: number }} options
 */
export async function checkCanvasDocument({
  inputPath,
  rootDir,
  display = "inline",
  theme = "light",
  screenshotPath,
  viewportWidth = null,
  timeoutMs = 15_000
}) {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteInput = path.resolve(inputPath);
  if (!isWithinPath(absoluteRoot, absoluteInput)) {
    throw new Error("The canvas entry must be inside the served root.");
  }
  const viewport = DISPLAY_VIEWPORTS[display] ?? DISPLAY_VIEWPORTS.inline;
  const entryPath = path.relative(absoluteRoot, absoluteInput).split(path.sep).map(encodeURIComponent).join("/");
  const frameTheme = { mode: theme === "dark" ? "dark" : "light", tokens: {} };
  const server = await startCanvasServer({
    rootDir: absoluteRoot,
    harnessHtml: () => buildHarnessHtml({
      entryUrl: `${FRAME_PREFIX}${entryPath}`,
      frameHeight: viewport.frameHeight,
      autoHeight: viewport.autoHeight,
      theme: frameTheme
    })
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = ensurePlaywrightBrowserInstalled("chromium");
  const browser = await chromium.launch({ executablePath: runtime.executablePath, headless: true, chromiumSandbox: false });
  const failedRequests = [];

  try {
    const page = await browser.newPage({ viewport: { width: viewportWidth ?? viewport.width, height: viewport.height } });
    const recordFailure = (url, status, reason) => {
      const framePath = toFramePath(url, origin);
      if (url.endsWith("/favicon.ico") || failedRequests.some((request) => request.url === framePath)) return;
      failedRequests.push({ url: framePath, status, reason });
    };
    page.on("response", (response) => {
      if (response.status() >= 400) recordFailure(response.url(), response.status(), null);
    });
    page.on("requestfailed", (request) => recordFailure(request.url(), null, request.failure()?.errorText ?? null));

    await page.goto(`${origin}/__harness`, { waitUntil: "load", timeout: timeoutMs });
    await waitForSettledFrame(page, timeoutMs);
    const messages = await page.evaluate(() => window.__canvasCheck.messages);
    const summary = summarizeMessages(messages, origin);

    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.locator("iframe").screenshot({ path: screenshotPath, timeout: timeoutMs }).catch(() => null);

    return {
      ok: summary.ready && !summary.blank && summary.errors.length === 0 && failedRequests.length === 0,
      loaded: summary.ready,
      blank: summary.blank,
      title: summary.title,
      content_height: summary.contentHeight,
      errors: summary.errors,
      failed_requests: failedRequests,
      hints: buildHints({ summary, failedRequests }),
      screenshot_path: await fs.stat(screenshotPath).then(() => screenshotPath).catch(() => null)
    };
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(() => resolve()));
  }
}
