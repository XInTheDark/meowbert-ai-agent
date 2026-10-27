import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);

it("loads the canvas runtime from a clean distribution build", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "meowbert-canvas-build-"));
  try {
    const require = createRequire(import.meta.url);
    const project = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
    await run(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", project, "--outDir", output, "--declaration", "false"]);
    const runtimeUrl = pathToFileURL(path.join(output, "canvas-frame-runtime.mjs")).href;
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", [
      `const runtime = await import(${JSON.stringify(runtimeUrl)});`,
      'const html = runtime.injectCanvasFrameRuntime("<head></head>");',
      'const source = html.slice(html.indexOf(">", html.indexOf("<script")) + 1, html.lastIndexOf("</script>"));',
      'new Function(source); console.log("loaded");'
    ].join("\n")]);
    expect(stdout.trim()).toBe("loaded");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}, 30_000);
