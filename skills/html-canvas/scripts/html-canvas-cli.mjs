#!/usr/bin/env node
import { renderHtmlCanvasDocument, scaffoldHtmlCanvasTemplate } from "../../shared/html-canvas-utils.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}".`);
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { command, options };
}

function requireString(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required option --${key}.`);
  }
  return value;
}

function optionalString(options, key) {
  const value = options[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalInteger(options, key) {
  const value = optionalString(options, key);
  if (value === null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Option --${key} must be a positive integer.`);
  }
  return parsed;
}

async function runScaffold(options) {
  return scaffoldHtmlCanvasTemplate({
    template: requireString(options, "template"),
    outputPath: requireString(options, "output"),
    title: optionalString(options, "title"),
    subtitle: optionalString(options, "subtitle")
  });
}

async function runRender(options) {
  return renderHtmlCanvasDocument({
    inputPath: requireString(options, "input"),
    outputDir: requireString(options, "output-dir"),
    layout: optionalString(options, "layout") ?? "slides",
    orientation: optionalString(options, "orientation"),
    pageSelector: optionalString(options, "page-selector") ?? undefined,
    viewportWidth: optionalInteger(options, "viewport-width"),
    viewportHeight: optionalInteger(options, "viewport-height"),
    waitForSelector: optionalString(options, "wait-for-selector"),
    createPdf: options["create-pdf"] === true,
    pdfFileName: optionalString(options, "pdf-file-name") ?? "document.pdf",
    timeoutMs: optionalInteger(options, "timeout-ms") ?? 30_000
  });
}

function printHelp() {
  console.log(`Usage:
  node scripts/html-canvas-cli.mjs scaffold --template slide-deck --output ./canvas/deck.html [--title "..."] [--subtitle "..."]
  node scripts/html-canvas-cli.mjs render --input ./canvas/deck.html --output-dir ./canvas/output [--layout slides|pages|single] [--orientation portrait|landscape] [--create-pdf]
  node scripts/html-canvas-cli.mjs render --input ./canvas/slides --output-dir ./canvas/output [--layout slides|pages|single] [--orientation portrait|landscape] [--create-pdf]
`);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "--help" || command === "-h" || options.help === true) {
    printHelp();
    return;
  }

  let result;
  if (command === "scaffold") {
    result = await runScaffold(options);
  } else if (command === "render") {
    result = await runRender(options);
  } else {
    throw new Error(`Unsupported command "${command}".`);
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.ok === false) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
