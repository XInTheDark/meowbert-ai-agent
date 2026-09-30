import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("playwright browser runtime bundle", () => {
  it("installs bundled chromium when browser-use or html-canvas is enabled", () => {
    const repoRoot = path.resolve(__dirname, "../../../../..");
    const dockerfile = fs.readFileSync(path.join(repoRoot, "apps/sandbox-runtime/Dockerfile"), "utf-8");
    const composeOverride = fs.readFileSync(path.join(repoRoot, "docker-compose.local-sandbox.yml"), "utf-8");

    expect(dockerfile).toMatch(/ARG MEOWBERT_HTML_CANVAS_ENABLED/);
    expect(dockerfile).toMatch(/MEOWBERT_HTML_CANVAS_ENABLED/);
    expect(dockerfile).toMatch(/playwrightBrowsersEnabled/);
    expect(composeOverride).toMatch(/MEOWBERT_HTML_CANVAS_ENABLED/);
  });

  it("launches Browser Use through the local wrapper so the executable path is pinned", () => {
    const repoRoot = path.resolve(__dirname, "../../../../..");
    const manifest = fs.readFileSync(path.join(repoRoot, "skills/browser-use/skill.json"), "utf-8");
    const server = fs.readFileSync(path.join(repoRoot, "skills/browser-use/server.mjs"), "utf-8");

    expect(manifest).toMatch(/"args": \["server\.mjs"\]/);
    expect(server).toMatch(/@playwright\/mcp\/cli\.js/);
    expect(server).toMatch(/--executable-path/);
    expect(server).toMatch(/resolveTaskPathBaseDir/);
    expect(server).toMatch(/--output-dir/);
    expect(server).not.toMatch(/cwd:\s*["']\/tmp["']/);
    expect(server).toMatch(/cwd:\s*taskDir/);
    expect(server).toMatch(/PLAYWRIGHT_MCP_OUTPUT_DIR:\s*taskDir/);
  });
});
