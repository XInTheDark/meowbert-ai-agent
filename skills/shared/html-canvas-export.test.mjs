import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { exportHtmlCanvasDocument } from "./html-canvas-export.mjs";
const directories = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture(html) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-export-"));
  directories.push(directory);
  const inputPath = path.join(directory, "index.html");
  await fs.writeFile(inputPath, html);
  return { directory, inputPath, outputPath: path.join(directory, "standalone.html") };
}
describe("standalone HTML export", () => {
  it("retains SVG view and filter fragments on embedded assets", async () => {
    const files = await fixture('<img src="icons.svg?version=2#left"><style>.shadow { filter:url(filters.svg#shadow); }</style><p style="filter:url(#local)">Text</p>');
    const icons = '<svg xmlns="http://www.w3.org/2000/svg"><view id="left" viewBox="0 0 10 10"/></svg>';
    const filters = '<svg xmlns="http://www.w3.org/2000/svg"><filter id="shadow"/></svg>';
    await fs.writeFile(path.join(files.directory, "icons.svg"), icons);
    await fs.writeFile(path.join(files.directory, "filters.svg"), filters);
    await exportHtmlCanvasDocument(files);
    const dom = new JSDOM(await fs.readFile(files.outputPath, "utf8"));
    try {
      expect(dom.window.document.querySelector("img").getAttribute("src")).toBe(`data:image/svg+xml;base64,${Buffer.from(icons).toString("base64")}#left`);
      expect(dom.window.document.querySelector("style").textContent).toContain(`url("data:image/svg+xml;base64,${Buffer.from(filters).toString("base64")}#shadow")`);
      expect(dom.window.document.querySelector("p").getAttribute("style")).toContain('url("#local")');
    } finally { dom.window.close(); }
  });
  it("inlines nested CSS resources and deferred scripts without changing source", async () => {
    const html = '<link rel="stylesheet" href="./theme.css"><script src="./app.js" defer></script><img src="./logo.svg">';
    const files = await fixture(html);
    await fs.mkdir(path.join(files.directory, "assets"));
    await fs.writeFile(path.join(files.directory, "theme.css"), '@import "./assets/type.css"; body { background:url("./logo.svg"); }');
    await fs.writeFile(path.join(files.directory, "assets/type.css"), '@font-face { font-family:Test; src:url("font.woff2"); }');
    await fs.writeFile(path.join(files.directory, "assets/font.woff2"), "font-data");
    await fs.writeFile(path.join(files.directory, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await fs.writeFile(path.join(files.directory, "app.js"), "window.didRun = Boolean(document.querySelector('img'));");
    await exportHtmlCanvasDocument(files);
    const output = await fs.readFile(files.outputPath, "utf8");
    expect(output).toContain("data:font/woff2;base64,");
    expect(output).toContain("data:image/svg+xml;base64,");
    expect(output).not.toContain("@import");
    const dom = new JSDOM(output, { runScripts: "dangerously", resources: "usable" });
    await new Promise((resolve) => dom.window.addEventListener("load", resolve));
    expect(dom.window.didRun).toBe(true);
    dom.window.close();
    expect(await fs.readFile(files.inputPath, "utf8")).toBe(html);
  });
  it("rejects external assets and modules instead of silently delivering a broken file", async () => {
    const external = await fixture('<img src="https://example.test/image.png">');
    await expect(exportHtmlCanvasDocument(external)).rejects.toThrow("external assets");
    const module = await fixture('<script type="module" src="app.js"></script>');
    await expect(exportHtmlCanvasDocument(module)).rejects.toThrow("Bundle modules");
  });
  it("rejects symlink escapes and overwriting the editable input", async () => {
    const files = await fixture('<img src="escape.svg">');
    const outside = await fixture("private");
    await fs.symlink(outside.inputPath, path.join(files.directory, "escape.svg"));
    await expect(exportHtmlCanvasDocument(files)).rejects.toThrow("outside the document folder");
    await expect(exportHtmlCanvasDocument({ ...files, outputPath: files.inputPath })).rejects.toThrow("editable source");
  });
});
