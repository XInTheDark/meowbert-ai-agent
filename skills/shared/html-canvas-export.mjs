import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { resolveTaskScopedUserPath } from "./task-path-utils.mjs";

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".gif": "image/gif", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };

async function localFile(reference, base, root) {
  const url = new URL(reference, pathToFileURL(base));
  if (url.protocol !== "file:") throw new Error(`Copy external assets beside the HTML before export: ${reference}`);
  const file = await fs.realpath(fileURLToPath(url));
  const relative = path.relative(root, file);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error(`Asset is outside the document folder: ${reference}`);
  return file;
}

async function dataUrl(reference, base, root) {
  if (reference.startsWith("data:") || reference.startsWith("#")) return reference;
  const file = await localFile(reference, base, root);
  const fragment = new URL(reference, pathToFileURL(base)).hash;
  return `data:${MIME[path.extname(file).toLowerCase()] || "application/octet-stream"};base64,${(await fs.readFile(file)).toString("base64")}${fragment}`;
}

async function inlineCss(css, base, root, seen = new Set()) {
  if (seen.has(base)) throw new Error(`Circular CSS import: ${base}`);
  const next = new Set([...seen, base]);
  for (const match of [...css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*([^;]*);/gi)]) {
    const file = await localFile(match[1], base, root);
    const imported = await inlineCss(await fs.readFile(file, "utf8"), file, root, next);
    css = css.replace(match[0], match[2].trim() ? `@media ${match[2]} {${imported}}` : imported);
  }
  if (css.includes("@import")) throw new Error("Flatten unsupported CSS @import rules before HTML export.");
  for (const match of [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)]) {
    css = css.replace(match[0], `url("${await dataUrl(match[1].trim(), base, root)}")`);
  }
  return css;
}

async function inlineDependencies(document, input, root) {
  if (document.querySelector("base, iframe, object, embed, script[type=module], [srcset]")) throw new Error("Bundle modules and embedded documents, and flatten srcset before standalone HTML export.");
  for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
    const file = await localFile(link.getAttribute("href"), input, root);
    const style = document.createElement("style");
    if (link.media) style.media = link.media;
    style.textContent = await inlineCss(await fs.readFile(file, "utf8"), file, root);
    link.replaceWith(style);
  }
  for (const style of document.querySelectorAll("style")) style.textContent = await inlineCss(style.textContent, input, root);
  for (const node of document.querySelectorAll("[style]")) node.setAttribute("style", await inlineCss(node.getAttribute("style"), input, root));
  for (const script of document.querySelectorAll("script[src]")) {
    const file = await localFile(script.getAttribute("src"), input, root);
    // A data URL preserves deferred script execution order and cannot close the surrounding HTML.
    script.setAttribute("src", `data:text/javascript;base64,${(await fs.readFile(file)).toString("base64")}`);
    script.removeAttribute("integrity");
  }
  for (const node of document.querySelectorAll("img[src], source[src], video[src], audio[src], video[poster], link[rel=icon][href]")) {
    for (const attribute of ["src", "poster", "href"]) {
      if (node.hasAttribute(attribute)) node.setAttribute(attribute, await dataUrl(node.getAttribute(attribute), input, root));
    }
  }
}

export async function exportHtmlCanvasDocument({ inputPath, outputPath }) {
  const input = await fs.realpath(resolveTaskScopedUserPath(inputPath));
  const output = resolveTaskScopedUserPath(outputPath);
  const existingOutput = await fs.realpath(output).catch(() => output);
  if (input === existingOutput) throw new Error("Export to a new HTML file so the editable source is preserved.");
  const dom = new JSDOM(await fs.readFile(input, "utf8"));
  try {
    await inlineDependencies(dom.window.document, input, path.dirname(input));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, dom.serialize());
    return { ok: true, html_path: output, source_path: input };
  } finally { dom.window.close(); }
}
