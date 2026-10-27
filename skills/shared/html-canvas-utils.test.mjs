import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const createdDirs = [];
const fakePageFactoryQueue = [];

function createFakePage() {
  const behavior = fakePageFactoryQueue.shift() ?? {};
  let closed = false;

  return {
    on() {},
    async emulateMedia() {},
    async goto() {},
    async waitForLoadState() {},
    async evaluate(...args) {
      if (typeof behavior.evaluate === "function") {
        return behavior.evaluate(...args);
      }
      return null;
    },
    async waitForFunction() {},
    async waitForSelector() {},
    async addStyleTag() {},
    async screenshot(options) {
      await fs.mkdir(path.dirname(options.path), { recursive: true });
      await fs.writeFile(options.path, "png");
    },
    locator() {
      return {
        async count() {
          return 1;
        },
        nth() {
          return {
            async screenshot(options) {
              await fs.mkdir(path.dirname(options.path), { recursive: true });
              await fs.writeFile(options.path, "png");
            }
          };
        }
      };
    },
    async pdf(options) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (closed) {
        throw new Error("page.pdf: Target page, context or browser has been closed");
      }
      const pdf = await PDFDocument.create();
      pdf.addPage([400, 240]);
      const pdfBytes = await pdf.save();
      await fs.mkdir(path.dirname(options.path), { recursive: true });
      await fs.writeFile(options.path, pdfBytes);
    },
    async close() {
      closed = true;
    }
  };
}

const launchMock = vi.fn(async () => ({
  async newContext() {
    return {
      async addInitScript() {},
      async newPage() {
        return createFakePage();
      },
      async close() {}
    };
  },
  async close() {}
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: launchMock
  }
}));

vi.mock("./playwright-browser-utils.mjs", () => ({
  ensurePlaywrightBrowserInstalled() {
    return {
      browserName: "chromium",
      browserRoot: "/mock-playwright",
      executablePath: "/mock-playwright/chromium"
    };
  }
}));

const {
  renderHtmlCanvasDocument,
  scaffoldHtmlCanvasTemplate
} = await import("./html-canvas-utils.mjs");

async function createTempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  launchMock.mockClear();
  fakePageFactoryQueue.length = 0;

  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("renderHtmlCanvasDocument", () => {
  it("waits for directory PDF generation before closing the page", async () => {
    const inputDir = await createTempDir("meowbert-html-canvas-dir-");
    const outputDir = await createTempDir("meowbert-html-canvas-output-");

    await fs.writeFile(path.join(inputDir, "01-cover.html"), "<!doctype html><html><body>Cover</body></html>");
    await fs.writeFile(path.join(inputDir, "02-middle.html"), "<!doctype html><html><body>Middle</body></html>");

    const result = await renderHtmlCanvasDocument({
      inputPath: inputDir,
      outputDir,
      layout: "slides",
      createPdf: true,
      pdfFileName: "slides.pdf",
      timeoutMs: 5_000
    });

    expect(result.pdf_path).toBe(path.join(outputDir, "slides.pdf"));
    const mergedPdf = await PDFDocument.load(await fs.readFile(result.pdf_path));
    expect(mergedPdf.getPageCount()).toBe(2);
  });

  it("waits for single-document PDF generation before closing the page", async () => {
    const inputDir = await createTempDir("meowbert-html-canvas-file-");
    const outputDir = await createTempDir("meowbert-html-canvas-file-output-");
    const inputPath = path.join(inputDir, "single.html");

    await fs.writeFile(inputPath, "<!doctype html><html><body>Single</body></html>");

    const result = await renderHtmlCanvasDocument({
      inputPath,
      outputDir,
      layout: "single",
      createPdf: true,
      pdfFileName: "single.pdf",
      timeoutMs: 5_000
    });

    expect(result.pdf_path).toBe(path.join(outputDir, "single.pdf"));
    const singlePdf = await PDFDocument.load(await fs.readFile(result.pdf_path));
    expect(singlePdf.getPageCount()).toBe(1);
  });

  it("supports forcing landscape orientation for page-style renders", async () => {
    const inputDir = await createTempDir("meowbert-html-canvas-orientation-");
    const outputDir = await createTempDir("meowbert-html-canvas-orientation-output-");
    const inputPath = path.join(inputDir, "page.html");

    await fs.writeFile(
      inputPath,
      "<!doctype html><html><body><section data-meowbert-page>Landscape page</section></body></html>"
    );

    const result = await renderHtmlCanvasDocument({
      inputPath,
      outputDir,
      layout: "pages",
      orientation: "landscape",
      timeoutMs: 5_000
    });

    expect(result.orientation).toBe("landscape");
    expect(result.viewport).toEqual({
      width: 1960,
      height: 1440
    });
  });

  it("reports overflow warnings when a fixed-size page still clips after fitting", async () => {
    const inputDir = await createTempDir("meowbert-html-canvas-overflow-");
    const outputDir = await createTempDir("meowbert-html-canvas-overflow-output-");

    await fs.writeFile(path.join(inputDir, "01-cutoff.html"), "<!doctype html><html><body>Cut off</body></html>");
    fakePageFactoryQueue.push({
      async evaluate() {
        return {
          targetWidthPx: 1600,
          targetHeightPx: 900,
          contentWidthPx: 1700,
          contentHeightPx: 1100,
          offsetXPx: 0,
          offsetYPx: 0,
          scaleApplied: 0.94,
          remainingOverflowXPx: 8,
          remainingOverflowYPx: 24
        };
      }
    });

    const result = await renderHtmlCanvasDocument({
      inputPath: inputDir,
      outputDir,
      layout: "slides",
      timeoutMs: 5_000
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.page_fit_adjustments).toEqual([
      expect.objectContaining({
        source_path: path.join(inputDir, "01-cutoff.html"),
        scale_applied: 0.94
      })
    ]);
    expect(result.diagnostics.page_overflow_warnings).toEqual([
      expect.objectContaining({
        source_path: path.join(inputDir, "01-cutoff.html"),
        overflow_x_px: 8,
        overflow_y_px: 24
      })
    ]);
  });
});

describe("scaffoldHtmlCanvasTemplate", () => {
  it.each(["document", "prototype", "animation"])("copies dependencies for the %s starter", async (template) => {
    const taskDir = await createTempDir("meowbert-starter-");
    const outputPath = path.join(taskDir, "index.html");
    const result = await scaffoldHtmlCanvasTemplate({ template, outputPath, title: "Title" });
    expect(await fs.readFile(outputPath, "utf8")).toContain("Title");
    for (const companion of result.companion_paths) await expect(fs.stat(companion)).resolves.toBeTruthy();
    expect(result.companion_paths.length).toBe(template === "animation" ? 0 : 1);
  });
  it("copies the deck component beside a scaffolded slide deck", async () => {
    const taskDir = await createTempDir("meowbert-deck-scaffold-");
    const outputPath = path.join(taskDir, "deck", "pitch.html");
    await scaffoldHtmlCanvasTemplate({ template: "slide-deck", outputPath, title: "Pitch" });

    const html = await fs.readFile(outputPath, "utf-8");
    const scriptSource = /<script src="\.\/([^"]+)"/.exec(html)?.[1];
    expect(scriptSource).toBeTruthy();
    await expect(fs.stat(path.join(taskDir, "deck", scriptSource))).resolves.toBeTruthy();
  });
});
