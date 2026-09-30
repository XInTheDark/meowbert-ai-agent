import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("skills container bundle", () => {
  it("bundles skills into the sandbox runtime image instead of masking them with compose binds", () => {
    const repoRoot = path.resolve(__dirname, "../../../../..");
    const dockerfilePath = path.join(repoRoot, "apps/sandbox-runtime/Dockerfile");
    const composePath = path.join(repoRoot, "docker-compose.yml");

    const dockerfile = fs.readFileSync(dockerfilePath, "utf-8");
    const compose = fs.readFileSync(composePath, "utf-8");

    expect(dockerfile).toMatch(/COPY skills skills/);
    expect(dockerfile).toMatch(/cd \/app\/skills\/deep-ai-search && npm ci --omit=dev --omit=optional/);
    expect(compose).not.toMatch(/source:\s*\.\/skills\s*\n\s*target:\s*\/app\/skills/);
  });
});
