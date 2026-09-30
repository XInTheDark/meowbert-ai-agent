import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("browser-use sandbox runtime bundle", () => {
  it("installs the same Playwright browser channel requested by the skill", () => {
    const repoRoot = path.resolve(__dirname, "../../../../..");
    const serverPath = path.join(repoRoot, "skills/browser-use/server.mjs");
    const dockerfilePath = path.join(repoRoot, "apps/sandbox-runtime/Dockerfile");

    const serverSource = fs.readFileSync(serverPath, "utf-8");
    const browserMatch = serverSource.match(/PLAYWRIGHT_MCP_BROWSER\s*\|\|\s*["']([^"']+)["']/);
    const requestedBrowser = browserMatch?.[1] ?? "chromium";
    const dockerfile = fs.readFileSync(dockerfilePath, "utf-8");

    expect(requestedBrowser).toBe("chromium");
    expect(dockerfile).toMatch(/PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1\s+\\?\s*npm ci/);
    expect(dockerfile).toMatch(new RegExp(`playwright install\\s+${requestedBrowser}`));
    expect(dockerfile).not.toMatch(new RegExp(`playwright install\\s+--only-shell\\s+${requestedBrowser}`));
  });
});
