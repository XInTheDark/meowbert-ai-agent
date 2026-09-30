import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("worker build config context", () => {
  it("keeps toggle-bearing config files available to build-time bundle scripts", () => {
    const repoRoot = path.resolve(__dirname, "../../../../..");
    const dockerignorePath = path.join(repoRoot, ".dockerignore");
    const dockerignore = fs.readFileSync(dockerignorePath, "utf-8");

    expect(dockerignore).toMatch(/^config\/\*\.json$/m);
    expect(dockerignore).toMatch(/^!config\/global\.json$/m);
    expect(dockerignore).toMatch(/^!config\/global\.docker\.json$/m);
    expect(dockerignore).toMatch(/^!config\/global\.example\.json$/m);
  });
});
