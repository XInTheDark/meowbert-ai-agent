import { isWithinPath } from "../../packages/shared/src/path-containment.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import { ensurePlaywrightBrowserInstalled } from "./playwright-browser-utils.mjs";
import { resolveTaskPathBaseDir, resolveTaskScopedUserPath } from "./task-path-utils.mjs";

export const HTML_CANVAS_PAGE_SELECTOR = "[data-meowbert-page]";

const TEMPLATE_FILES = {
  "slide-deck": "slide-deck.html",
  "report-pages": "report-pages.html"
};

// Files a template loads by relative path; scaffold copies them beside the output.
const TEMPLATE_COMPANION_FILES = {
  "slide-deck": ["meowbert-deck.js"]
};

function applyViewportOrientation(viewport, orientation = null) {
  if (orientation !== "portrait" && orientation !== "landscape") {
    return viewport;
  }

  const isLandscape = viewport.width >= viewport.height;
  if ((orientation === "landscape" && isLandscape) || (orientation === "portrait" && !isLandscape)) {
    return viewport;
  }

  return {
    width: viewport.height,
    height: viewport.width
  };
}

function resolveUserPath(inputPath) {
  return resolveTaskScopedUserPath(inputPath);
}

function defaultViewport(layout, orientation = null) {
  let viewport;
  if (layout === "single") {
    viewport = { width: 1440, height: 1080 };
  } else if (layout === "pages") {
    viewport = { width: 1440, height: 1960 };
  } else {
    viewport = { width: 1600, height: 900 };
  }
  return applyViewportOrientation(viewport, orientation);
}

function isHtmlEntrypoint(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return extension === ".html" || extension === ".htm";
}

function createDiagnostics() {
  return {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    pageFitAdjustments: [],
    pageOverflowWarnings: []
  };
}

function attachDiagnostics(page, diagnostics) {
  page.on("console", (message) => {
    const entry = {
      type: message.type(),
      text: message.text()
    };
    if (entry.type === "error") {
      diagnostics.consoleErrors.push(entry);
      return;
    }
    if (entry.type === "warning") {
      diagnostics.consoleWarnings.push(entry);
    }
  });

  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push(error instanceof Error ? error.message : String(error));
  });

  page.on("requestfailed", (request) => {
    diagnostics.requestFailures.push({
      url: request.url(),
      method: request.method(),
      errorText: request.failure()?.errorText ?? "Request failed"
    });
  });
}

async function waitForFonts(page) {
  await page.evaluate(async () => {
    if ("fonts" in document && document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
}

async function waitForReadySignal(page, timeoutMs) {
  await page.waitForFunction(() => window.__MEOWBERT_READY__ !== false, null, { timeout: timeoutMs });
}

async function stabilizePage(page, waitForSelector, timeoutMs) {
  await page.waitForLoadState("load", { timeout: timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5_000) }).catch(() => {});
  await waitForFonts(page);
  await waitForReadySignal(page, timeoutMs);
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: timeoutMs });
  }
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
      }
    `
  });
}

async function screenshotSinglePage(page, previewDir, fileName = "page-1.png") {
  const outputPath = path.join(previewDir, fileName);
  await page.screenshot({
    path: outputPath,
    fullPage: true,
    animations: "disabled"
  });
  return [outputPath];
}

async function screenshotViewportPage(page, previewDir, fileName) {
  const outputPath = path.join(previewDir, fileName);
  await page.screenshot({
    path: outputPath,
    animations: "disabled"
  });
  return outputPath;
}

async function screenshotPageElements(page, selector, previewDir) {
  const elements = page.locator(selector);
  const count = await elements.count();

  if (count < 1) {
    throw new Error(`No page elements matched selector "${selector}".`);
  }

  const outputPaths = [];
  for (let index = 0; index < count; index += 1) {
    const outputPath = path.join(previewDir, `page-${String(index + 1).padStart(2, "0")}.png`);
    await elements.nth(index).screenshot({
      path: outputPath,
      animations: "disabled"
    });
    outputPaths.push(outputPath);
  }

  return outputPaths;
}

async function writePreviewIndex(outputDir, previewItems) {
  const items = previewItems
    .map((previewItem) => {
      const relativePath = path.relative(outputDir, previewItem.previewPath);
      return `<figure><img src="${relativePath}" alt="${previewItem.label}"><figcaption>${previewItem.label}</figcaption></figure>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>HTML Canvas Preview Index</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        font-family: "Liberation Sans", "Noto Sans", sans-serif;
        background: #f3f4f6;
        color: #111827;
      }
      main {
        display: grid;
        gap: 24px;
      }
      figure {
        margin: 0;
      }
      img {
        display: block;
        max-width: min(100%, 1200px);
        border: 1px solid #d1d5db;
        background: white;
      }
      figcaption {
        margin-top: 8px;
        font-size: 14px;
        color: #4b5563;
      }
    </style>
  </head>
  <body>
    <main>
      ${items}
    </main>
  </body>
</html>
`;

  const indexPath = path.join(outputDir, "preview-index.html");
  await fs.writeFile(indexPath, html, "utf-8");
  return indexPath;
}

async function maybeWritePdf(page, outputDir, pdfFileName, createPdf) {
  if (!createPdf) {
    return null;
  }

  const pdfPath = path.join(outputDir, pdfFileName);
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: pdfPath,
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    outline: true
  });
  await page.emulateMedia({ media: "screen" });
  return pdfPath;
}

async function prepareFixedViewportPage(page, viewport) {
  await page.addStyleTag({
    content: `
      @page {
        size: var(--meowbert-print-page-width, auto) var(--meowbert-print-page-height, auto);
        margin: 0;
      }

      html {
        width: var(--meowbert-print-page-width, auto);
        height: var(--meowbert-print-page-height, auto);
      }

      html,
      body {
        margin: 0 !important;
        padding: 0 !important;
        background: white;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      body[data-meowbert-fixed-page="true"] {
        box-sizing: border-box;
        width: var(--meowbert-print-page-width, auto);
        height: var(--meowbert-print-page-height, auto);
        overflow: hidden;
        padding-left: var(--meowbert-print-offset-x, 0px) !important;
        padding-top: var(--meowbert-print-offset-y, 0px) !important;
      }

      #__MEOWBERT_FIXED_PAGE_ROOT__ {
        transform-origin: top left;
        transform: scale(var(--meowbert-print-scale, 1));
        width: var(--meowbert-print-root-width, auto);
        min-height: var(--meowbert-print-root-height, auto);
      }
    `
  });

  const layoutInfo = await page.evaluate(({ viewportWidth, viewportHeight }) => {
    const html = document.documentElement;
    const body = document.body;
    if (!body) {
      return null;
    }

    let root = document.getElementById("__MEOWBERT_FIXED_PAGE_ROOT__");
    if (!root) {
      root = document.createElement("div");
      root.id = "__MEOWBERT_FIXED_PAGE_ROOT__";
      while (body.firstChild) {
        root.appendChild(body.firstChild);
      }
      body.appendChild(root);
    }

    const rects = [];
    const elements = [root, ...root.querySelectorAll("*")];
    for (const element of elements) {
      if (!(element instanceof Element)) {
        continue;
      }

      for (const rect of element.getClientRects()) {
        if ((rect.width <= 0 && rect.height <= 0) || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
          continue;
        }
        rects.push({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        });
      }
    }

    let minLeft = 0;
    let minTop = 0;
    let maxRight = viewportWidth;
    let maxBottom = viewportHeight;
    for (const rect of rects) {
      minLeft = Math.min(minLeft, rect.left);
      minTop = Math.min(minTop, rect.top);
      maxRight = Math.max(maxRight, rect.right);
      maxBottom = Math.max(maxBottom, rect.bottom);
    }

    const scrollingElement = document.scrollingElement ?? html;
    const contentWidth = Math.max(
      Math.ceil(maxRight - minLeft),
      Math.ceil(scrollingElement.scrollWidth),
      Math.ceil(body.scrollWidth),
      viewportWidth
    );
    const contentHeight = Math.max(
      Math.ceil(maxBottom - minTop),
      Math.ceil(scrollingElement.scrollHeight),
      Math.ceil(body.scrollHeight),
      viewportHeight
    );
    const offsetX = Math.max(0, Math.ceil(-minLeft));
    const offsetY = Math.max(0, Math.ceil(-minTop));
    const availableWidth = Math.max(1, viewportWidth - offsetX);
    const availableHeight = Math.max(1, viewportHeight - offsetY);
    const scale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);
    const remainingOverflowX = Math.max(0, Math.ceil(offsetX + (contentWidth * scale) - viewportWidth));
    const remainingOverflowY = Math.max(0, Math.ceil(offsetY + (contentHeight * scale) - viewportHeight));

    html.style.setProperty("--meowbert-print-page-width", `${viewportWidth}px`);
    html.style.setProperty("--meowbert-print-page-height", `${viewportHeight}px`);
    html.style.setProperty("--meowbert-print-offset-x", `${offsetX}px`);
    html.style.setProperty("--meowbert-print-offset-y", `${offsetY}px`);
    html.style.setProperty("--meowbert-print-root-width", `${contentWidth}px`);
    html.style.setProperty("--meowbert-print-root-height", `${contentHeight}px`);
    html.style.setProperty("--meowbert-print-scale", String(scale));
    body.dataset.meowbertFixedPage = "true";

    return {
      targetWidthPx: viewportWidth,
      targetHeightPx: viewportHeight,
      contentWidthPx: contentWidth,
      contentHeightPx: contentHeight,
      offsetXPx: offsetX,
      offsetYPx: offsetY,
      scaleApplied: Number(scale.toFixed(4)),
      remainingOverflowXPx: remainingOverflowX,
      remainingOverflowYPx: remainingOverflowY
    };
  }, {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height
  });

  return layoutInfo && typeof layoutInfo === "object" ? layoutInfo : null;
}

function recordPageLayoutDiagnostics({
  diagnostics,
  sourcePath,
  pageLabel,
  layoutInfo
}) {
  if (!layoutInfo) {
    return;
  }

  if (
    layoutInfo.scaleApplied < 0.999
    || layoutInfo.offsetXPx > 0
    || layoutInfo.offsetYPx > 0
  ) {
    diagnostics.pageFitAdjustments.push({
      source_path: sourcePath,
      page_label: pageLabel,
      target_width_px: layoutInfo.targetWidthPx,
      target_height_px: layoutInfo.targetHeightPx,
      content_width_px: layoutInfo.contentWidthPx,
      content_height_px: layoutInfo.contentHeightPx,
      offset_x_px: layoutInfo.offsetXPx,
      offset_y_px: layoutInfo.offsetYPx,
      scale_applied: layoutInfo.scaleApplied
    });
  }

  if (layoutInfo.remainingOverflowXPx > 0 || layoutInfo.remainingOverflowYPx > 0) {
    diagnostics.pageOverflowWarnings.push({
      source_path: sourcePath,
      page_label: pageLabel,
      target_width_px: layoutInfo.targetWidthPx,
      target_height_px: layoutInfo.targetHeightPx,
      content_width_px: layoutInfo.contentWidthPx,
      content_height_px: layoutInfo.contentHeightPx,
      offset_x_px: layoutInfo.offsetXPx,
      offset_y_px: layoutInfo.offsetYPx,
      scale_applied: layoutInfo.scaleApplied,
      overflow_x_px: layoutInfo.remainingOverflowXPx,
      overflow_y_px: layoutInfo.remainingOverflowYPx,
      message: `Content still exceeds the fixed page bounds by ${layoutInfo.remainingOverflowXPx}px horizontally and ${layoutInfo.remainingOverflowYPx}px vertically.`
    });
  }
}

async function collectPageElementOverflowWarnings(page, selector) {
  const warnings = await page.evaluate((pageSelector) => {
    const pageElements = Array.from(document.querySelectorAll(pageSelector));
    return pageElements
      .map((element, index) => {
        if (!(element instanceof HTMLElement)) {
          return null;
        }

        const overflowX = Math.max(0, Math.ceil(element.scrollWidth - element.clientWidth));
        const overflowY = Math.max(0, Math.ceil(element.scrollHeight - element.clientHeight));
        if (overflowX === 0 && overflowY === 0) {
          return null;
        }

        return {
          pageLabel: `page-${String(index + 1).padStart(2, "0")}`,
          contentWidthPx: Math.ceil(element.scrollWidth),
          contentHeightPx: Math.ceil(element.scrollHeight),
          targetWidthPx: Math.ceil(element.clientWidth),
          targetHeightPx: Math.ceil(element.clientHeight),
          overflowXPx: overflowX,
          overflowYPx: overflowY
        };
      })
      .filter(Boolean);
  }, selector);

  return Array.isArray(warnings) ? warnings : [];
}

async function renderPageToPdfFile(page, pdfPath, viewport) {
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: pdfPath,
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    outline: true,
    width: `${viewport.width}px`,
    height: `${viewport.height}px`
  });
  await page.emulateMedia({ media: "screen" });
  return pdfPath;
}

async function resolveHtmlInputMode(absoluteInputPath) {
  const inputStats = await fs.stat(absoluteInputPath).catch(() => null);
  if (!inputStats) {
    throw new Error(`Input path not found: ${absoluteInputPath}`);
  }

  if (inputStats.isFile()) {
    return {
      inputMode: "file",
      htmlPaths: [absoluteInputPath]
    };
  }

  if (!inputStats.isDirectory()) {
    throw new Error("Input path must be an HTML file or a directory of HTML files.");
  }

  const entries = await fs.readdir(absoluteInputPath, { withFileTypes: true });
  const htmlPaths = entries
    .filter((entry) => entry.isFile() && isHtmlEntrypoint(entry.name))
    .map((entry) => path.join(absoluteInputPath, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), undefined, {
      sensitivity: "base",
      numeric: true
    }));

  if (htmlPaths.length === 0) {
    throw new Error(`No .html or .htm files found in directory: ${absoluteInputPath}`);
  }

  return {
    inputMode: "directory",
    htmlPaths
  };
}

async function maybeWriteDirectoryPdf({
  context,
  htmlPaths,
  outputDir,
  pdfFileName,
  createPdf,
  viewport,
  timeoutMs,
  waitForSelector,
  diagnostics
}) {
  if (!createPdf) {
    return null;
  }

  const tempDir = await fs.mkdtemp(path.join(outputDir, ".html-canvas-pdf-pages-"));
  const mergedPdf = await PDFDocument.create();
  try {
    for (let index = 0; index < htmlPaths.length; index += 1) {
      const htmlPath = htmlPaths[index];
      const page = await context.newPage();
      attachDiagnostics(page, diagnostics);
      try {
        await page.goto(pathToFileURL(htmlPath).toString(), {
          waitUntil: "load",
          timeout: timeoutMs
        });
        await stabilizePage(page, waitForSelector, timeoutMs);
        await prepareFixedViewportPage(page, viewport);
        const pagePdfPath = path.join(tempDir, `page-${String(index + 1).padStart(2, "0")}.pdf`);
        await renderPageToPdfFile(page, pagePdfPath, viewport);
        const pagePdfBytes = await fs.readFile(pagePdfPath);
        const sourcePdf = await PDFDocument.load(pagePdfBytes);
        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        copiedPages.forEach((pdfPage) => mergedPdf.addPage(pdfPage));
      } finally {
        await page.close();
      }
    }

    const mergedPdfPath = path.join(outputDir, pdfFileName);
    await fs.writeFile(mergedPdfPath, await mergedPdf.save());
    return mergedPdfPath;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function createRenderResult({
  inputPath,
  inputMode,
  outputDir,
  layout,
  orientation,
  selector,
  viewport,
  previewPaths,
  sourceFiles,
  previewIndexPath,
  pdfPath,
  diagnostics,
  runtime
}) {
  const hasHardFailures = diagnostics.pageErrors.length > 0
    || diagnostics.requestFailures.length > 0
    || diagnostics.consoleErrors.length > 0
    || diagnostics.pageOverflowWarnings.length > 0;

  return {
    ok: !hasHardFailures,
    input_path: inputPath,
    input_mode: inputMode,
    output_dir: outputDir,
    layout,
    orientation,
    page_selector: selector,
    viewport,
    source_files: sourceFiles,
    preview_paths: previewPaths,
    preview_index_path: previewIndexPath,
    pdf_path: pdfPath,
    preview_count: previewPaths.length,
    runtime: {
      browser: runtime.browserName,
      executable_path: runtime.executablePath,
      browsers_path: runtime.browserRoot
    },
    diagnostics: {
      console_errors: diagnostics.consoleErrors,
      console_warnings: diagnostics.consoleWarnings,
      page_errors: diagnostics.pageErrors,
      request_failures: diagnostics.requestFailures,
      page_fit_adjustments: diagnostics.pageFitAdjustments,
      page_overflow_warnings: diagnostics.pageOverflowWarnings
    }
  };
}

export function listHtmlCanvasTemplates() {
  return Object.keys(TEMPLATE_FILES);
}

export async function scaffoldHtmlCanvasTemplate({
  template,
  outputPath,
  title,
  subtitle
}) {
  const fileName = TEMPLATE_FILES[template];
  if (!fileName) {
    throw new Error(`Unsupported template "${template}".`);
  }

  const sharedDir = path.dirname(fileURLToPath(import.meta.url));
  const templateDir = path.resolve(sharedDir, "../html-canvas/assets/templates");
  const absoluteOutputPath = resolveUserPath(outputPath);
  const outputDir = path.dirname(absoluteOutputPath);
  const templateContents = await fs.readFile(path.join(templateDir, fileName), "utf-8");
  const rendered = templateContents
    .replaceAll("{{TITLE}}", title ?? "Canvas document")
    .replaceAll("{{SUBTITLE}}", subtitle ?? "Generated with html-canvas");

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(absoluteOutputPath, rendered, "utf-8");
  const companionPaths = [];
  for (const companionFile of TEMPLATE_COMPANION_FILES[template] ?? []) {
    const companionPath = path.join(outputDir, companionFile);
    await fs.copyFile(path.join(templateDir, companionFile), companionPath);
    companionPaths.push(companionPath);
  }

  return {
    ok: true,
    template,
    output_path: absoluteOutputPath,
    companion_paths: companionPaths
  };
}

export async function createInlineHtmlArtifact({
  html,
  outputPath,
  title = null,
  description = null,
  width = null,
  height = null
}) {
  const absoluteOutputPath = resolveUserPath(outputPath);
  const taskRootPath = resolveTaskPathBaseDir();
  const relativePath = path.relative(taskRootPath, absoluteOutputPath);
  if (!isWithinPath(taskRootPath, absoluteOutputPath)) {
    throw new Error("Inline artifact output_path must stay inside the current task directory.");
  }

  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await fs.writeFile(absoluteOutputPath, html, "utf-8");

  return {
    ok: true,
    output_path: absoluteOutputPath,
    inline_artifact: {
      type: "html",
      relative_path: relativePath.split(path.sep).join("/"),
      title,
      description,
      width,
      height
    }
  };
}

export async function createInlineFileArtifact({
  inputPath,
  type,
  title = null,
  description = null,
  width = null,
  height = null
}) {
  if (!["html", "image", "mermaid"].includes(type)) {
    throw new Error("Inline file artifact type must be html, image, or mermaid.");
  }

  const absoluteInputPath = resolveUserPath(inputPath);
  const taskRootPath = resolveTaskPathBaseDir();
  const relativePath = path.relative(taskRootPath, absoluteInputPath);
  if (!isWithinPath(taskRootPath, absoluteInputPath)) {
    throw new Error("Inline artifact input_path must stay inside the current task directory.");
  }

  const stat = await fs.stat(absoluteInputPath);
  if (!stat.isFile()) {
    throw new Error("Inline artifact input_path must point to a file.");
  }

  return {
    ok: true,
    input_path: absoluteInputPath,
    inline_artifact: {
      type,
      relative_path: relativePath.split(path.sep).join("/"),
      title,
      description,
      width,
      height
    }
  };
}

export async function renderHtmlCanvasDocument({
  inputPath,
  outputDir,
  layout,
  orientation = null,
  pageSelector = HTML_CANVAS_PAGE_SELECTOR,
  viewportWidth,
  viewportHeight,
  waitForSelector = null,
  createPdf = false,
  pdfFileName = "document.pdf",
  timeoutMs = 30_000
}) {
  const absoluteInputPath = resolveUserPath(inputPath);
  const absoluteOutputDir = resolveUserPath(outputDir);
  const input = await resolveHtmlInputMode(absoluteInputPath);
  const runtime = ensurePlaywrightBrowserInstalled("chromium");
  const viewport = {
    ...defaultViewport(layout, orientation),
    ...(viewportWidth ? { width: viewportWidth } : {}),
    ...(viewportHeight ? { height: viewportHeight } : {})
  };
  const diagnostics = createDiagnostics();
  const browser = await chromium.launch({
    executablePath: runtime.executablePath,
    headless: true,
    chromiumSandbox: false
  });

  try {
    await fs.mkdir(absoluteOutputDir, { recursive: true });
    const previewDir = path.join(absoluteOutputDir, "preview");
    await fs.mkdir(previewDir, { recursive: true });

    const context = await browser.newContext({ viewport });
    // Lets page components such as <meowbert-deck> lay out every page for capture.
    await context.addInitScript(() => {
      window.__MEOWBERT_RENDER__ = true;
    });
    const previewItems = [];
    const sourceFiles = [];

    if (input.inputMode === "directory") {
      for (let index = 0; index < input.htmlPaths.length; index += 1) {
        const htmlPath = input.htmlPaths[index];
        const page = await context.newPage();
        attachDiagnostics(page, diagnostics);
        try {
          await page.emulateMedia({ media: "screen" });
          await page.goto(pathToFileURL(htmlPath).toString(), {
            waitUntil: "load",
            timeout: timeoutMs
          });
          await stabilizePage(page, waitForSelector, timeoutMs);
          const layoutInfo = await prepareFixedViewportPage(page, viewport);
          recordPageLayoutDiagnostics({
            diagnostics,
            sourcePath: htmlPath,
            pageLabel: path.basename(htmlPath),
            layoutInfo
          });
          const previewPath = await screenshotViewportPage(
            page,
            previewDir,
            `page-${String(index + 1).padStart(2, "0")}.png`
          );
          previewItems.push({
            previewPath,
            label: `${String(index + 1).padStart(2, "0")} · ${path.basename(htmlPath)}`
          });
          sourceFiles.push({
            source_path: htmlPath,
            preview_path: previewPath
          });
        } finally {
          await page.close();
        }
      }
    } else {
      const page = await context.newPage();
      attachDiagnostics(page, diagnostics);
      try {
        await page.emulateMedia({ media: "screen" });
        await page.goto(pathToFileURL(absoluteInputPath).toString(), {
          waitUntil: "load",
          timeout: timeoutMs
        });
        await stabilizePage(page, waitForSelector, timeoutMs);
        if (layout !== "single") {
          const overflowWarnings = await collectPageElementOverflowWarnings(page, pageSelector);
          diagnostics.pageOverflowWarnings.push(...overflowWarnings.map((warning) => ({
            source_path: absoluteInputPath,
            page_label: warning.pageLabel,
            target_width_px: warning.targetWidthPx,
            target_height_px: warning.targetHeightPx,
            content_width_px: warning.contentWidthPx,
            content_height_px: warning.contentHeightPx,
            offset_x_px: 0,
            offset_y_px: 0,
            scale_applied: 1,
            overflow_x_px: warning.overflowXPx,
            overflow_y_px: warning.overflowYPx,
            message: `Page wrapper content exceeds its page box by ${warning.overflowXPx}px horizontally and ${warning.overflowYPx}px vertically.`
          })));
        }

        const previewPaths = layout === "single"
          ? await screenshotSinglePage(page, previewDir)
          : await screenshotPageElements(page, pageSelector, previewDir);
        previewItems.push(...previewPaths.map((previewPath) => ({
          previewPath,
          label: path.basename(previewPath)
        })));
        sourceFiles.push({
          source_path: absoluteInputPath,
          preview_path: previewPaths[0] ?? null
        });
      } finally {
        await page.close();
      }
    }

    const previewPaths = previewItems.map((item) => item.previewPath);
    const previewIndexPath = await writePreviewIndex(absoluteOutputDir, previewItems);
    const pdfPath = input.inputMode === "directory"
      ? await maybeWriteDirectoryPdf({
          context,
          htmlPaths: input.htmlPaths,
          outputDir: absoluteOutputDir,
          pdfFileName,
          createPdf,
          viewport,
          timeoutMs,
          waitForSelector,
          diagnostics
        })
      : await (async () => {
          if (!createPdf) {
            return null;
          }
          const page = await context.newPage();
          attachDiagnostics(page, diagnostics);
          try {
            await page.emulateMedia({ media: "screen" });
            await page.goto(pathToFileURL(absoluteInputPath).toString(), {
              waitUntil: "load",
              timeout: timeoutMs
            });
            await stabilizePage(page, waitForSelector, timeoutMs);
            return await maybeWritePdf(page, absoluteOutputDir, pdfFileName, true);
          } finally {
            await page.close();
          }
        })();

    await context.close();

    return createRenderResult({
      inputPath: absoluteInputPath,
      inputMode: input.inputMode,
      outputDir: absoluteOutputDir,
      layout,
      orientation,
      selector: pageSelector,
      viewport,
      previewPaths,
      sourceFiles,
      previewIndexPath,
      pdfPath,
      diagnostics,
      runtime
    });
  } finally {
    await browser.close();
  }
}
